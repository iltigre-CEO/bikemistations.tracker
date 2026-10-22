export const connectionStates = [
  "NOT_CONNECTED", "WAITING_FOR_SMS", "CONNECTED", "SESSION_EXPIRED",
  "AUTHENTICATION_FAILED", "SYNCING", "ERROR"
] as const;

export type ConnectionState = (typeof connectionStates)[number];

export type Connection = {
  userId: string;
  state: ConnectionState;
  phoneNumber: string | null;
  updatedAt: string;
  errorMessage: string | null;
};

export type Ride = {
  providerRideId: string;
  userId: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  startStation: string | null;
  endStation: string | null;
  bikeType: string | null;
};

export type Station = {
  active?: boolean;
  stationId: string;
  name: string;
  latitude: number;
  longitude: number;
  bikesAvailable: number | null;
  docksAvailable: number | null;
  updatedAt: string;
};
