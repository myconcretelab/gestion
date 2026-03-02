import { type ChangeEvent } from "react";

type StatSwitchProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

const StatSwitch = ({ label, checked, onChange }: StatSwitchProps) => {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.checked);
  };

  return (
    <label className="stats-switch">
      <input type="checkbox" checked={checked} onChange={handleChange} />
      <span className="slider" aria-hidden="true" />
      <span className="stats-switch-label">{label}</span>
    </label>
  );
};

export default StatSwitch;
