import Chip from '@material-ui/core/Chip';
import { makeStyles } from '@material-ui/core/styles';
import CancelOutlinedIcon from '@material-ui/icons/CancelOutlined';
import CheckCircleOutlineIcon from '@material-ui/icons/CheckCircleOutline';
import type { BrunoResultStatus } from '@sbordeyne/bruno-report-type';
import { memo } from 'react';

export interface StatusChipProps {
  status: BrunoResultStatus;
}

const useStyles = makeStyles(theme => ({
  pass: {
    borderColor: theme.palette.success.main,
    color: theme.palette.success.main,
  },
  error: {
    borderColor: theme.palette.error.main,
    color: theme.palette.error.main,
  },
}));

/**
 * Status is carried by an icon and a word as well as colour, so it survives
 * colour-blindness, forced-colors and printing.
 */
function StatusChipComponent({ status }: StatusChipProps): JSX.Element {
  const classes = useStyles();
  const isPass = status === 'pass';

  return (
    <Chip
      size="small"
      variant="outlined"
      className={isPass ? classes.pass : classes.error}
      icon={isPass ? <CheckCircleOutlineIcon fontSize="small" /> : <CancelOutlinedIcon fontSize="small" />}
      label={isPass ? 'Pass' : 'Error'}
    />
  );
}

export const StatusChip = memo(StatusChipComponent);
