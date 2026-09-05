/**
 * Логотип приложения: свой (из настроек оформления, data-URL) или стандартная иконка.
 * Обычный <img>: data-URL и приватные изображения оптимизатору next/image не нужны.
 */
export function BrandLogo({ src, size = 36, className = "" }: { src: string | null; size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src || "/icons/icon-192.png"} alt="" width={size} height={size} className={`object-contain ${className}`} style={{ width: size, height: size }} />;
}
