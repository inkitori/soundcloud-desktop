import { invoke } from "@tauri-apps/api/core";
import type {
  AuthStatus,
  CacheStats,
  CachedRow,
  FeedItem,
  LikeItem,
  Page,
  PlaybackSource,
  Playlist,
  ResolvedEntity,
  Track,
  User,
  Waveform,
} from "./types";

export const api = {
  // auth
  authStatus: () => invoke<AuthStatus>("auth_status"),
  authSetToken: (token: string) => invoke<User>("auth_set_token", { token }),
  authClearToken: () => invoke<void>("auth_clear_token"),
  authSetDatadome: (cookie: string) => invoke<void>("auth_set_datadome", { cookie }),

  // reads
  getStream: (nextHref?: string) =>
    invoke<Page<FeedItem>>("get_stream", { nextHref: nextHref ?? null }),
  getMyLikes: (nextHref?: string) =>
    invoke<Page<LikeItem>>("get_my_likes", { nextHref: nextHref ?? null }),
  getMyPlaylists: (nextHref?: string) =>
    invoke<Page<Playlist>>("get_my_playlists", { nextHref: nextHref ?? null }),
  getPlaylist: (id: number) => invoke<Playlist>("get_playlist", { id }),
  getTrack: (id: number) => invoke<Track>("get_track", { id }),
  getTracksByIds: (ids: number[]) => invoke<Track[]>("get_tracks_by_ids", { ids }),
  getUser: (id: number) => invoke<User>("get_user", { id }),
  getUserTracks: (id: number, nextHref?: string) =>
    invoke<Page<Track>>("get_user_tracks", { id, nextHref: nextHref ?? null }),
  getUserToptracks: (id: number, nextHref?: string) =>
    invoke<Page<Track>>("get_user_toptracks", { id, nextHref: nextHref ?? null }),
  getUserLikes: (id: number, nextHref?: string) =>
    invoke<Page<LikeItem>>("get_user_likes", { id, nextHref: nextHref ?? null }),
  getUserPlaylists: (id: number, nextHref?: string) =>
    invoke<Page<Playlist>>("get_user_playlists", { id, nextHref: nextHref ?? null }),
  getRelatedTracks: (trackId: number, nextHref?: string) =>
    invoke<Page<Track>>("get_related_tracks", { trackId, nextHref: nextHref ?? null }),
  searchTracks: (q: string, nextHref?: string) =>
    invoke<Page<Track>>("search_tracks", { q, nextHref: nextHref ?? null }),
  searchUsers: (q: string, nextHref?: string) =>
    invoke<Page<User>>("search_users", { q, nextHref: nextHref ?? null }),
  searchPlaylists: (q: string, nextHref?: string) =>
    invoke<Page<Playlist>>("search_playlists", { q, nextHref: nextHref ?? null }),
  resolveUrl: (url: string) => invoke<ResolvedEntity>("resolve_url", { url }),
  getWaveform: (url: string) => invoke<Waveform>("get_waveform", { url }),

  // playback
  getPlaybackSource: (track: Track, forceRefresh: boolean) =>
    invoke<PlaybackSource>("get_playback_source", { track, forceRefresh }),
  notePlayed: (trackId: number) => invoke<void>("note_played", { trackId }),

  // writes
  likeTrack: (trackId: number) => invoke<void>("like_track", { trackId }),
  unlikeTrack: (trackId: number) => invoke<void>("unlike_track", { trackId }),
  likePlaylist: (playlistId: number) => invoke<void>("like_playlist", { playlistId }),
  unlikePlaylist: (playlistId: number) => invoke<void>("unlike_playlist", { playlistId }),
  playlistAddTrack: (playlistId: number, trackId: number) =>
    invoke<void>("playlist_add_track", { playlistId, trackId }),
  playlistRemoveTrack: (playlistId: number, trackId: number) =>
    invoke<void>("playlist_remove_track", { playlistId, trackId }),

  // downloads
  downloadTrack: (trackId: number, pin = true) =>
    invoke<void>("download_track", { trackId, pin }),
  cancelDownload: (trackId: number) => invoke<void>("cancel_download", { trackId }),
  removeDownload: (trackId: number) => invoke<void>("remove_download", { trackId }),
  setPinned: (trackId: number, pinned: boolean) =>
    invoke<void>("set_pinned", { trackId, pinned }),
  listDownloads: () => invoke<CachedRow[]>("list_downloads"),
  cacheStats: () => invoke<CacheStats>("cache_stats"),
  setCacheCap: (bytes: number) => invoke<number[]>("set_cache_cap", { bytes }),

  // now playing
  npSetMetadata: (
    title: string,
    artist: string,
    artworkUrl: string | null,
    durationS: number,
    permalinkUrl: string | null,
  ) => invoke<void>("np_set_metadata", { title, artist, artworkUrl, durationS, permalinkUrl }),
  npSetPlayback: (playing: boolean, positionS: number) =>
    invoke<void>("np_set_playback", { playing, positionS }),
  discordSetEnabled: (enabled: boolean) => invoke<void>("discord_set_enabled", { enabled }),
};
