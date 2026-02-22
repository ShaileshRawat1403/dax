import { createProvider } from "./stub";
import { Provider } from "./types";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createAnthropic = (config: any): Provider => createProvider("anthropic");
