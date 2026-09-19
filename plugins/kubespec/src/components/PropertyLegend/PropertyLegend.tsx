import { Flex, Text } from '@backstage/ui';
import { makeStyles, useTheme } from '@material-ui/core/styles';

import { CATEGORY_LABELS, PropertyTypeCategory, getPropertyTypePalette } from '../../lib/propertyTypePalette';

const useStyles = makeStyles({
  swatch: {
    fontFamily: 'var(--bui-font-mono, monospace)',
    fontSize: '0.75rem',
    fontWeight: 600,
  },
});

const CATEGORIES: PropertyTypeCategory[] = ['object', 'string', 'number', 'boolean', 'timestamp', 'opaque'];

/** Names every colour in words, so the mapping is learnable rather than decorative. */
export function PropertyLegend(): JSX.Element {
  const classes = useStyles();
  const theme = useTheme();
  const palette = getPropertyTypePalette(theme.palette.type === 'dark');

  return (
    <Flex direction="column" gap="2">
      <Text variant="body-small" color="secondary">
        Click a property name for its description, or the chevron to open an object. Required properties are marked{' '}
        <span style={{ color: palette.required }}>*</span>.
      </Text>
      <Flex gap="4" align="center">
        {CATEGORIES.map(category => (
          <span key={category} className={classes.swatch} style={{ color: palette[category] }}>
            {CATEGORY_LABELS[category]}
          </span>
        ))}
      </Flex>
    </Flex>
  );
}
