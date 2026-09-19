export interface Config {
  kubespec?: {
    /**
     * The source the page opens on, and the one `/kubespec` redirects to.
     * @visibility frontend
     * @default 'kubernetes'
     */
    defaultSource?: string;

    /**
     * Where readers are sent to contribute an example or a documentation link.
     * Omit it and the empty states drop the call to action rather than linking
     * nowhere.
     * @visibility frontend
     */
    contributeUrl?: string;
  };
}
