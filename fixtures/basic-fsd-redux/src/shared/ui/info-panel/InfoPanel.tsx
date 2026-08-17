import type { ReactNode } from "react";

type InfoPanelProps = {
  title: string;
  addon?: ReactNode;
};

export function InfoPanel({ title, addon }: InfoPanelProps) {
  return (
    <section>
      <h2>{title}</h2>
      {addon}
    </section>
  );
}
