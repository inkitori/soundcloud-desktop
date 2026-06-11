export interface User {
  id: number;
  username?: string | null;
  permalink_url?: string | null;
  avatar_url?: string | null;
  followers_count?: number | null;
  followings_count?: number | null;
  track_count?: number | null;
  description?: string | null;
  full_name?: string | null;
  city?: string | null;
  verified?: boolean | null;
}

export interface Format {
  protocol: string;
  mime_type: string;
}

export interface Transcoding {
  url: string;
  preset?: string | null;
  snipped: boolean;
  quality?: string | null;
  format?: Format | null;
}

export interface Media {
  transcodings: Transcoding[];
}

export interface Track {
  id: number;
  kind?: string | null;
  title?: string | null;
  permalink_url?: string | null;
  artwork_url?: string | null;
  duration?: number | null;
  full_duration?: number | null;
  user?: User | null;
  media?: Media | null;
  waveform_url?: string | null;
  streamable?: boolean | null;
  policy?: string | null;
  monetization_model?: string | null;
  playback_count?: number | null;
  likes_count?: number | null;
  genre?: string | null;
  created_at?: string | null;
  track_authorization?: string | null;
}

export interface Playlist {
  id: number;
  kind?: string | null;
  title?: string | null;
  permalink_url?: string | null;
  artwork_url?: string | null;
  user?: User | null;
  track_count?: number | null;
  tracks: Track[];
  is_album?: boolean | null;
  duration?: number | null;
  likes_count?: number | null;
  created_at?: string | null;
}

export interface FeedItem {
  type: string;
  created_at?: string | null;
  track?: Track | null;
  playlist?: Playlist | null;
  user?: User | null;
  caption?: string | null;
}

export interface LikeItem {
  created_at?: string | null;
  kind?: string | null;
  track?: Track | null;
  playlist?: Playlist | null;
}

export interface Page<T> {
  collection: T[];
  next_href?: string | null;
}

export interface Waveform {
  width: number;
  height: number;
  samples: number[];
}

export type ResolvedEntity =
  | { kind: "track"; track: Track }
  | { kind: "user"; user: User }
  | { kind: "playlist"; playlist: Playlist }
  | { kind: "unknown" };

export interface ResolvedStream {
  url: string;
  protocol: string;
  preset?: string | null;
  quality?: string | null;
  snipped: boolean;
  expires_at?: number | null;
}

export type PlaybackSource =
  | { kind: "cached"; asset_path: string }
  | ({ kind: "stream" } & ResolvedStream);

export interface AuthStatus {
  logged_in: boolean;
  me?: User | null;
}

export interface CachedRow {
  track_id: number;
  file_name: string;
  title?: string | null;
  artist?: string | null;
  artwork_url?: string | null;
  duration_ms?: number | null;
  preset?: string | null;
  bytes: number;
  pinned: boolean;
  downloaded_at: number;
  last_played_at: number;
}

export interface CacheStats {
  bytes_used: number;
  byte_cap: number;
  count: number;
}

export interface AppError {
  code: string;
  message: string;
  retry_after?: number | null;
}
