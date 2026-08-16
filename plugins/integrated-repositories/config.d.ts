/**
 * A scalar prefilled into the onboarding wizard's form, or a list of them.
 *
 * @visibility frontend
 */
type OnboardingDefaultLeaf = string | number | boolean | (string | number | boolean)[];

/**
 * A value prefilled into the onboarding wizard's form: a scalar, a list of scalars, or one level of
 * nesting for an object-typed template parameter.
 *
 * Every string is expanded against the repository the action was triggered from — see
 * `onboardingTemplateDefaults`.
 *
 * @visibility frontend
 */
type OnboardingDefaultValue = OnboardingDefaultLeaf | { [key: string]: OnboardingDefaultLeaf };

export interface Config {
  integratedRepositories?: {
    /**
     * GitHub organization enumerated to enrich the catalog view with the repositories that never
     * produced an entity.
     *
     * A missing organization is not fatal: the page falls back to the catalog-only view.
     *
     * @visibility frontend
     */
    organization?: string;

    /**
     * Entity ref of the software template offered as the onboarding action on uncovered
     * repositories, for example `template:default/onboard-repository`. The kind defaults to
     * `template` and the namespace to `default`.
     *
     * With no template configured — or a ref that cannot be parsed — the table offers no onboarding
     * action at all, which is the right behaviour for an installation that has not published one.
     *
     * @visibility frontend
     */
    onboardingTemplateRef?: string;

    /**
     * The form values the onboarding wizard opens with, keyed by the template's own parameter
     * names. They are passed through the `formData` query parameter the wizard parses on mount.
     *
     * Every string is expanded against the repository the action was triggered from, with
     * `{{ field }}` placeholders over these fields: `repo`, `org`, `url`, `defaultBranch`,
     * `primaryLanguage`, `status`. A placeholder may carry a fallback used when the field is
     * missing, written `{{ defaultBranch | master }}`; without one, a missing field expands to the
     * empty string.
     *
     * Defaults to the shape the stock `onboard-repository` template expects:
     *
     * ```yaml
     * repoUrl: 'github.com?owner={{ org }}&repo={{ repo }}'
     * name: '{{ repo }}'
     * defaultBranch: '{{ defaultBranch | master }}'
     * ```
     *
     * Set it whenever your template names its parameters differently. Only fields derivable from a
     * repository belong here — a wrong default in an owner or lifecycle picker is worse than an
     * empty one.
     *
     * @visibility frontend
     */
    onboardingTemplateDefaults?: { [parameter: string]: OnboardingDefaultValue };

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
