export function BrandMark({ size = 34 }: { size?: number }) {
  return <span className="noor-mark" style={{ width: size, height: size }} aria-hidden="true">
    <span className="noor-mark-core" />
    <span className="noor-mark-ray ray-one" />
    <span className="noor-mark-ray ray-two" />
    <span className="noor-mark-ray ray-three" />
    <span className="noor-mark-ray ray-four" />
  </span>;
}
