import { MissingAnnotationEmptyState, useEntity } from '@backstage/plugin-catalog-react';
import { Route, Routes } from 'react-router-dom';

import { BRUNO_REPORT_ANNOTATION, isBrunoReportsAvailable } from '../plugin';
import { BrunoReportPage } from './BrunoReportPage';

export const Router = () => {
  const { entity } = useEntity();

  if (!isBrunoReportsAvailable(entity)) {
    return <MissingAnnotationEmptyState annotation={BRUNO_REPORT_ANNOTATION} />;
  }

  return (
    <Routes>
      <Route path="/" element={<BrunoReportPage />} />
    </Routes>
  );
};
