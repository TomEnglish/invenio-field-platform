import { ScanScreenContent } from '@/components/screens/ScanScreen';

export default function ScanScreen() {
  return (
    <ScanScreenContent
      materialDetailRoute="/(office)/material-detail"
      receivingRoute="/(office)/receiving"
      crateRoute="/(office)/crate"
      packRoute="/(office)/pack"
    />
  );
}
