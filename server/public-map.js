"use strict";

const { createClient } = require("@supabase/supabase-js");

const PUBLIC_MAP_VIEW = "civicx_public_map_reports";
const COMMUNITY_POSTS_TABLE = "community_posts";
const COMMUNITY_IMAGE_BUCKET = "civicx-community";
const PAGE_SIZE = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_COLUMNS = [
  "community_post_id", "category", "description", "city", "locality",
  "status", "report_date", "latitude", "longitude", "display_name", "has_photo"
].join(",");

function createServiceClient(options) {
  if (options.client) return options.client;
  if (!options.supabaseUrl || !options.serviceRoleKey) {
    throw new TypeError("Supabase URL and service role key are required for public map access.");
  }
  return createClient(options.supabaseUrl, options.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
}

function parseMapBounds(query) {
  const allowed = new Set(["south", "north", "west", "east"]);
  if (!query || typeof query !== "object" || Array.isArray(query) ||
      Object.keys(query).some((key) => !allowed.has(key))) {
    throw new TypeError("Provide only south, north, west, and east map bounds.");
  }

  const coordinate = (name, minimum, maximum) => {
    const raw = query[name];
    if (typeof raw !== "string" || !raw.trim()) {
      throw new TypeError("Provide valid map bounds.");
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new TypeError("Provide valid map bounds.");
    }
    return value;
  };

  const bounds = {
    south: coordinate("south", -90, 90),
    north: coordinate("north", -90, 90),
    west: coordinate("west", -180, 180),
    east: coordinate("east", -180, 180)
  };
  if (bounds.south >= bounds.north) throw new TypeError("Provide a non-empty map area.");
  return bounds;
}

function publicReport(row) {
  if (row.latitude === null || row.latitude === undefined ||
      row.longitude === null || row.longitude === undefined) return null;
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      typeof row.community_post_id !== "string" || !UUID_PATTERN.test(row.community_post_id) ||
      typeof row.category !== "string" || typeof row.description !== "string" ||
      typeof row.city !== "string" || typeof row.locality !== "string" ||
      typeof row.status !== "string" || typeof row.report_date !== "string" ||
      typeof row.display_name !== "string") {
    return null;
  }

  return {
    communityPostId: row.community_post_id,
    category: row.category,
    description: row.description,
    city: row.city,
    locality: row.locality,
    status: row.status,
    date: row.report_date,
    latitude,
    longitude,
    displayName: row.display_name,
    hasPhoto: row.has_photo === true
  };
}

function createPublicMapService(options = {}) {
  const client = createServiceClient(options);

  async function rowsInBox(bounds, west, east) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client.from(PUBLIC_MAP_VIEW)
        .select(SAFE_COLUMNS)
        .gte("latitude", bounds.south)
        .lte("latitude", bounds.north)
        .gte("longitude", west)
        .lte("longitude", east)
        .order("report_date", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The public map view returned an invalid result.");
      rows.push(...data);
      if (data.length < PAGE_SIZE) return rows;
    }
  }

  async function listReports(bounds) {
    const boxes = bounds.west <= bounds.east
      ? [[bounds.west, bounds.east]]
      : [[bounds.west, 180], [-180, bounds.east]];
    const results = [];
    const seen = new Set();
    for (const [west, east] of boxes) {
      const rows = await rowsInBox(bounds, west, east);
      for (const row of rows) {
        const report = publicReport(row);
        if (report && !seen.has(report.communityPostId)) {
          seen.add(report.communityPostId);
          results.push(report);
        }
      }
    }
    return results;
  }

  async function getPhoto(communityPostId) {
    if (typeof communityPostId !== "string" || !UUID_PATTERN.test(communityPostId)) return null;
    const { data: visiblePost, error: visiblePostError } = await client.from(PUBLIC_MAP_VIEW)
      .select("community_post_id")
      .eq("community_post_id", communityPostId)
      .maybeSingle();
    if (visiblePostError) throw visiblePostError;
    if (!visiblePost) return null;

    const { data: post, error: postError } = await client.from(COMMUNITY_POSTS_TABLE)
      .select("image_path")
      .eq("id", communityPostId)
      .eq("visibility", "published")
      .not("linked_report_id", "is", null)
      .maybeSingle();
    if (postError) throw postError;
    if (!post?.image_path) return null;

    const { data: image, error: imageError } = await client.storage
      .from(COMMUNITY_IMAGE_BUCKET)
      .download(post.image_path);
    if (imageError) throw imageError;
    if (!image || typeof image.arrayBuffer !== "function") {
      throw new Error("The public map photo could not be read.");
    }

    const extension = post.image_path.split(".").pop()?.toLowerCase();
    const contentType = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp"
    }[extension];
    if (!contentType) throw new Error("The public map photo has an unsupported format.");
    return {
      body: Buffer.from(await image.arrayBuffer()),
      contentType
    };
  }

  return Object.freeze({ getPhoto, listReports });
}

module.exports = { createPublicMapService, parseMapBounds };
