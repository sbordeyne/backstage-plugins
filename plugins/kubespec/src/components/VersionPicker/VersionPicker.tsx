import { Select } from '@backstage/ui';

import { LATEST_VERSION } from '../../lib/paths';

export interface VersionPickerProps {
  /** Newest first, as the backend ordered them. */
  versions: string[];
  /** The raw URL segment, which may be the literal `latest`. */
  value: string;
  /** What `latest` currently resolves to, shown alongside the alias. */
  resolvedVersion?: string;
  onChange: (version: string) => void;
}

/**
 * Version ordering is entirely the backend's: the list arrives newest first.
 *
 * Nothing here re-implements version comparison, which is the one way the picker
 * and the data it navigates to could disagree.
 */
export function VersionPicker(props: VersionPickerProps): JSX.Element {
  const options = [
    {
      value: LATEST_VERSION,
      label: props.resolvedVersion ? `latest (${props.resolvedVersion})` : 'latest',
    },
    ...props.versions.map(version => ({ value: version, label: version })),
  ];

  // The version in the URL is always offered, even before the list has loaded or
  // if it falls outside it. Without this the trigger falls back to its
  // placeholder — "Select an option" — on a page that is plainly showing a
  // version, because a selected key with no matching option selects nothing.
  if (props.value !== LATEST_VERSION && !props.versions.includes(props.value)) {
    options.splice(1, 0, { value: props.value, label: props.value });
  }

  return (
    <Select
      name="kubespec-version"
      aria-label="Version"
      selectedKey={props.value}
      onSelectionChange={key => props.onChange(String(key))}
      options={options}
    />
  );
}
