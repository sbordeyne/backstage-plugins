import { parseEntityRef } from '@backstage/catalog-model';
import { ErrorPanel, Link, Progress } from '@backstage/core-components';
import { humanizeEntityRef } from '@backstage/plugin-catalog-react';
import { Chip, List, ListItem, ListItemText, Typography } from '@material-ui/core';
import Alert from '@material-ui/lab/Alert';
import { formatTimeRemaining } from '../../formatting';
import { SharedPasteView, useSharedWithMe } from '../../hooks/useSharedWithMe';
import { useSecureShareConfig } from '../../hooks/useSecureShareConfig';

interface SharedWithMeCardProps {
  /** Overrides `secureShare.card.limit`. */
  limit?: number;
}

function SharedPasteItem({ paste }: { paste: SharedPasteView }): JSX.Element {
  const sender = humanizeEntityRef(parseEntityRef(paste.summary.createdByEntityRef), { defaultKind: 'user' });
  return (
    <ListItem divider>
      <ListItemText
        primary={
          paste.unreadable ? (
            <Typography variant="body2" color="textSecondary">
              {paste.title}
            </Typography>
          ) : (
            <Link to={`/secure-share/paste/${paste.summary.id}`}>{paste.title}</Link>
          )
        }
        secondary={`from ${sender} · ${formatTimeRemaining(paste.summary.expiresAt)}`}
      />
      {paste.summary.burnAfterRead ? <Chip size="small" label="burns after reading" /> : null}
    </ListItem>
  );
}

/**
 * Homepage card listing the secrets most recently shared with the signed in user.
 *
 * Everything on show is decrypted in the browser: without this browser's device key the
 * card has nothing to display, which is why it asks for enrollment instead of failing.
 */
export function SharedWithMeCard({ limit }: SharedWithMeCardProps): JSX.Element {
  const config = useSecureShareConfig();
  const { value, loading, error, deviceMissing } = useSharedWithMe({ limit: limit ?? config.card.limit });

  if (loading) {
    return <Progress />;
  }
  if (deviceMissing) {
    return (
      <Alert severity="info">
        <Link to="/secure-share">Enroll this browser</Link> to receive shared secrets. Its key stays in this browser, so
        anything shared with you elsewhere cannot be read here.
      </Alert>
    );
  }
  if (error) {
    return <ErrorPanel title="Could not load what has been shared with you" error={error} />;
  }
  if (value.length === 0) {
    return <Typography variant="body2">Nothing has been shared with you yet.</Typography>;
  }

  return (
    <List dense>
      {value.map(paste => (
        <SharedPasteItem key={paste.summary.id} paste={paste} />
      ))}
    </List>
  );
}
