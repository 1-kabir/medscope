import { Client, TablesDB, Storage, Functions, Query, ExecutionMethod, Account, ID, Permission, Role } from "appwrite";

export const APPWRITE_ENDPOINT =
  import.meta.env.VITE_APPWRITE_ENDPOINT ?? "https://appwrite.kabirstudios.com/v1";
export const APPWRITE_PROJECT = import.meta.env.VITE_APPWRITE_PROJECT ?? "medscope";

export const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT);

export const tablesDB = new TablesDB(client);
export const storage = new Storage(client);
export const functions = new Functions(client);
export const account = new Account(client);
export { Query, ExecutionMethod, ID, Permission, Role };

export const DATABASE_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID ?? "medscope";

export const Collections = {
  medicines: "medicines",
  takenLogs: "taken_logs",
  devices: "devices",
  contacts: "contacts",
  alerts: "alerts",
  backups: "backups",
  members: "members",
} as const;
