import { createProvider } from "./stub";
import { Provider } from "./types";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createGoogle = (config: any): Provider => createProvider("google");
