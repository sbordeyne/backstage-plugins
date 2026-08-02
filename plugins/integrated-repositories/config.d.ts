export interface Config {
  integratedRepositories?: {
    /**
     * Primary languages selected when the page first loads, matched case-insensitively against the
     * languages GitHub reports. Only languages that actually occur are selected; if none of them
     * do, the selection stays empty, which means "all languages".
     *
     * Defaults to an empty list. Pin it to keep the headline coverage figure comparable over time.
     *
     * @visibility frontend
     */
    defaultLanguages?: string[];
  };
}
