import { ChevronRight } from "lucide-react";

const segments = (value: string) => value.replaceAll("\\", "/").split("/").filter(Boolean);

export function DirectoryBreadcrumb({ directory, relativePath = "", onNavigate }: {
  directory: string;
  relativePath?: string;
  onNavigate: (path: string) => void;
}) {
  if (!directory) return null;
  const folders = segments(relativePath);
  return <nav className="directory-breadcrumb" aria-label="Directory breadcrumb" title={directory}>
    <button type="button" className="directory-root" aria-label={`Open project directory ${directory}`} title={directory} onClick={() => onNavigate("")}>{directory}</button>
    {folders.map((segment, index) => {
      const path = folders.slice(0, index + 1).join("/");
      const current = index === folders.length - 1;
      return <span className="directory-crumb" key={path}>
        <ChevronRight size={13} aria-hidden="true" />
        <button type="button" aria-current={current ? "page" : undefined} title={path} onClick={() => onNavigate(path)}>{segment}</button>
      </span>;
    })}
  </nav>;
}
