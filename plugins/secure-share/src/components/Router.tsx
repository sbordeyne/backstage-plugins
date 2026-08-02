import { Route, Routes } from 'react-router-dom';
import { LinkedPasteViewPage } from './LinkedPasteViewPage';
import { PasteViewPage } from './PasteViewPage';
import { SecureShareHomePage } from './SecureShareHomePage';

export function Router(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<SecureShareHomePage />} />
      <Route path="/paste/:pasteId" element={<PasteViewPage />} />
      <Route path="/link/:pasteId" element={<LinkedPasteViewPage />} />
    </Routes>
  );
}
