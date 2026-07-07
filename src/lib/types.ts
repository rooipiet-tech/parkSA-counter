/** Shared domain types. */

export interface Provider {
  id: string;
  name: string;
  sort_order: number;
  hidden: boolean;
  is_permanent: boolean;
}

/** A single tap event. Client-generated UUID id is the primary key. */
export interface TapEvent {
  id: string;
  provider_id: string;
  device_ts: string; // ISO timestamp captured on the device at tap time
  session_id: string;
  observer_label: string;
  location_label: string;
  synced_offline: boolean; // written by the CLIENT at enqueue time, never inferred later
  clock_suspect: boolean; // stamped at flush time when |device-server skew| > 120s
  received_at?: string; // stamped by the backend adapter on accept
}

/** An event as stored by the backend (received_at always present). */
export interface ServerEvent extends TapEvent {
  received_at: string;
}

/** Append-only undo marker. Events are NEVER updated or deleted. */
export interface Tombstone {
  event_id: string;
  created_at: string;
}

export type EndSource = 'normal' | 'retroactive';

export interface Session {
  id: string;
  start_ts: string;
  end_ts?: string | null;
  end_source?: EndSource | null;
  observer_label: string;
  location_label: string;
}

/** Local session-log row: full event plus local bookkeeping flags. */
export interface LogRow extends TapEvent {
  seq: number; // tap order within the device
  tombstoned: boolean;
  synced: boolean;
}

export interface QueueState {
  events: Array<TapEvent & { tombstoned: boolean; synced: boolean }>;
  pendingCount: number;
}

export const DEFAULT_LOCATION = 'OR Tambo Parkade 2 South Level 3';
