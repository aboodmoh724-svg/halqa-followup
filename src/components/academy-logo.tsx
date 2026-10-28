import Image from "next/image";
import { academyLogoPath, academyName } from "@/lib/branding";
export default function AcademyLogo({ size = 44 }: { size?: number }) {
  return (
    <Image
      className="academy-logo"
      src={academyLogoPath}
      alt={`شعار ${academyName}`}
      width={size}
      height={Math.round((size * 1280) / 1170)}
      unoptimized
      priority={size >= 60}
    />
  );
}
