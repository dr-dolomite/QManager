import { Suspense } from "react";

import CellularHistory from "@/components/history/cellular/cellular-history";

// `useSearchParams` (the ?mock= preview switch) needs a Suspense boundary in a
// static export.
const CellularHistoryPage = () => {
  return (
    <Suspense fallback={null}>
      <CellularHistory />
    </Suspense>
  );
};

export default CellularHistoryPage;
