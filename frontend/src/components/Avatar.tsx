interface Props {
  url: string | null;
  size?: number;
  alt?: string;
}

export default function Avatar({ url, size = 48, alt = 'avatar' }: Props) {
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    objectFit: 'cover',
    background: '#eee',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size * 0.55,
    flexShrink: 0,
  };
  if (!url) return <span style={style} aria-label={alt}>👤</span>;
  return <img src={url} alt={alt} style={style} />;
}
