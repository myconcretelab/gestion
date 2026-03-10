declare module "react-gauge-chart" {
  import { ComponentType, CSSProperties } from "react";

  type GaugeChartProps = {
    id: string;
    nrOfLevels?: number;
    percent?: number;
    colors?: string[];
    arcWidth?: number;
    hideText?: boolean;
    needleColor?: string;
    animate?: boolean;
    style?: CSSProperties;
  };

  const GaugeChart: ComponentType<GaugeChartProps>;
  export default GaugeChart;
}
