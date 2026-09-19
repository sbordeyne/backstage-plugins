import { makeStyles, useTheme } from '@material-ui/core/styles';

import { categorizePropertyType, getPropertyTypePalette } from '../../lib/propertyTypePalette';

const useStyles = makeStyles({
  label: {
    fontFamily: 'var(--bui-font-mono, monospace)',
    fontSize: '0.8125rem',
    fontWeight: 600,
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'inherit',
  },
});

export interface PropertyTypeLabelProps {
  type: string;
  isArray: boolean;
  hasChildren: boolean;
}

/**
 * The type of a property, coloured by what kind of thing it is.
 *
 * Colour is never the only signal — the row also draws a chevron and a child
 * count — because roughly one man in twelve cannot use the hue on its own.
 */
export function PropertyTypeLabel(props: PropertyTypeLabelProps): JSX.Element {
  const classes = useStyles();
  const theme = useTheme();
  const palette = getPropertyTypePalette(theme.palette.type === 'dark');
  const category = categorizePropertyType(props.type, props.hasChildren);

  return (
    <span className={classes.label} style={{ color: palette[category] }}>
      {props.type}
      {props.isArray ? '[]' : ''}
    </span>
  );
}
