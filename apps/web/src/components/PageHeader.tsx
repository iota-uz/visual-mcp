import { SectionHeader, type SectionHeaderProps } from "./ui/SectionHeader";

/** The page's own `<h1>` header. Everything else is `SectionHeader`. */
export function PageHeader(props: Omit<SectionHeaderProps, "as">) {
  return <SectionHeader as="h1" {...props} />;
}
