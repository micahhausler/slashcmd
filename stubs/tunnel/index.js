const unsupported = () => {
  throw new Error("slashcmd does not support HTTP proxies");
};

export const httpOverHttp = unsupported;
export const httpsOverHttp = unsupported;
export const httpOverHttps = unsupported;
export const httpsOverHttps = unsupported;
