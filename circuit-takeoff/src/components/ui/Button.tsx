import { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: Props) {
  const base =
    "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
  const styles = {
    primary: "bg-perry-blue text-white hover:brightness-110",
    secondary:
      "border border-perry-silver bg-white text-perry-industrial hover:bg-perry-white",
    ghost: "text-perry-industrial hover:bg-perry-white",
    danger: "bg-perry-signal text-white hover:brightness-110",
  };
  return (
    <button className={`${base} ${styles[variant]} ${className}`} {...props} />
  );
}
