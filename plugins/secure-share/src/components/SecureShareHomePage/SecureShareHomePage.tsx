import { Content, Header, InfoCard, Page } from '@backstage/core-components';
import { Grid } from '@material-ui/core';
import { CreatePasteForm } from '../CreatePasteForm';
import { DeviceKeysCard } from '../DeviceKeysCard';
import { SharedWithMeCard } from '../SharedWithMeCard';

export function SecureShareHomePage(): JSX.Element {
  return (
    <Page themeId="tool">
      <Header
        title="Secure share"
        subtitle="Share credentials, text and files that expire on their own and that only the recipients can read"
      />
      <Content>
        <Grid container spacing={3}>
          <Grid item xs={12} md={7}>
            <CreatePasteForm />
          </Grid>
          <Grid item xs={12} md={5}>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <InfoCard title="Shared with me">
                  <SharedWithMeCard />
                </InfoCard>
              </Grid>
              <Grid item xs={12}>
                <DeviceKeysCard />
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </Content>
    </Page>
  );
}
