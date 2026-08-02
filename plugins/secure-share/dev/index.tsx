import { createDevApp } from '@backstage/dev-utils';
import { secureSharePlugin, SecureSharePage } from '../src/plugin';

createDevApp()
  .registerPlugin(secureSharePlugin)
  .addPage({
    element: <SecureSharePage />,
    title: 'Secure share',
    path: '/secure-share',
  })
  .render();
