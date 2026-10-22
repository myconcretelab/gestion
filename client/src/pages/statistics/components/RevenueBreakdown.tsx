import { formatEuro } from "../../../utils/format";

type RevenueBreakdownProps = {
  withoutOptions: number;
  options: number;
};

const RevenueBreakdown = ({ withoutOptions, options }: RevenueBreakdownProps) => (
  <small className="stats-revenue-breakdown">
    <span>Sans options : {formatEuro(withoutOptions)}</span>
    <span>Options : {formatEuro(options)}</span>
  </small>
);

export default RevenueBreakdown;
