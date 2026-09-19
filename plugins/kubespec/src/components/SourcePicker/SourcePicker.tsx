import { Select } from '@backstage/ui';
import type { KubespecSourceSummary } from '@sbordeyne/kubespec-common';

export interface SourcePickerProps {
  sources: KubespecSourceSummary[];
  value: string;
  onChange: (sourceId: string) => void;
}

export function SourcePicker(props: SourcePickerProps): JSX.Element {
  return (
    <Select
      name="kubespec-source"
      aria-label="Source"
      selectedKey={props.value}
      onSelectionChange={key => props.onChange(String(key))}
      options={props.sources.map(source => ({ value: source.slug, label: source.name }))}
    />
  );
}
