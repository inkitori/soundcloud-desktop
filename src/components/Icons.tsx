interface IconProps {
  size?: number;
  className?: string;
}

function svg(path: React.ReactNode, viewBox = "0 0 24 24") {
  return function Icon({ size = 18, className = "" }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="currentColor"
        className={className}
        aria-hidden
      >
        {path}
      </svg>
    );
  };
}

export const IconPlay = svg(<path d="M8 5.5v13l11-6.5z" />);
export const IconPause = svg(<path d="M7 5h3.5v14H7zm6.5 0H17v14h-3.5z" />);
export const IconPrev = svg(<path d="M6 6h2.5v12H6zm12 0v12l-9-6z" />);
export const IconNext = svg(<path d="M15.5 6H18v12h-2.5zM6 6l9 6-9 6z" />);
export const IconHeart = svg(
  <path
    d="M12 21s-7.5-4.7-10-9.3C.6 8.3 2.6 4.5 6.2 4.5c2.2 0 3.8 1.2 4.8 2.9 1-1.7 2.6-2.9 4.8-2.9 3.6 0 5.6 3.8 4.2 7.2C19.5 16.3 12 21 12 21z"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  />,
);
export const IconHeartFilled = svg(
  <path d="M12 21s-7.5-4.7-10-9.3C.6 8.3 2.6 4.5 6.2 4.5c2.2 0 3.8 1.2 4.8 2.9 1-1.7 2.6-2.9 4.8-2.9 3.6 0 5.6 3.8 4.2 7.2C19.5 16.3 12 21 12 21z" />,
);
export const IconRepeat = svg(
  <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />,
);
export const IconRadio = svg(
  <>
    <circle cx="12" cy="12" r="2.5" />
    <path
      d="M6.3 17.7a8 8 0 0 1 0-11.4M17.7 6.3a8 8 0 0 1 0 11.4M3.5 20.5a12 12 0 0 1 0-17M20.5 3.5a12 12 0 0 1 0 17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </>,
);
export const IconQueue = svg(
  <path d="M3 6h18v2H3zm0 5h12v2H3zm0 5h12v2H3zm16-3v6.5a2.5 2.5 0 1 1-2-2.45V13h-2v-2h4z" />,
);
export const IconDownload = svg(
  <path d="M12 3v10l3.5-3.5L17 11l-5 5-5-5 1.5-1.5L12 13V3zM5 19h14v2H5z" />,
);
export const IconCheck = svg(<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />);
export const IconX = svg(
  <path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4L13.4 12z" />,
);
export const IconSearch = svg(
  <path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z" />,
);
export const IconHome = svg(<path d="M12 3 2 12h3v8h6v-6h2v6h6v-8h3z" />);
export const IconList = svg(
  <path d="M4 6h2v2H4zm4 0h12v2H8zM4 11h2v2H4zm4 0h12v2H8zM4 16h2v2H4zm4 0h12v2H8z" />,
);
export const IconSettings = svg(
  <path d="M19.4 13a7.8 7.8 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.7 7.7 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.8 7.8 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.7 7.7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.7 7.7 0 0 0 1.7-1l2.4 1 2-3.4zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />,
);
export const IconVolume = svg(
  <path d="M3 9v6h4l5 5V4L7 9zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" />,
);
export const IconPlus = svg(<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />);
export const IconChevronLeft = svg(
  <path d="M15.4 6.4 14 5l-7 7 7 7 1.4-1.4L9.8 12z" />,
);
export const IconChevronRight = svg(
  <path d="M8.6 6.4 10 5l7 7-7 7-1.4-1.4 5.6-5.6z" />,
);
export const IconCloud = svg(
  <path d="M19.4 10.04A7.5 7.5 0 0 0 5.07 8.11 5.5 5.5 0 0 0 6 19h13a4.5 4.5 0 0 0 .4-8.96z" />,
);
export const IconExternal = svg(
  <path d="M14 5h5v5h-2V8.4l-7.3 7.3-1.4-1.4L15.6 7H14zM5 7h6v2H7v8h8v-4h2v6H5z" />,
);

export function Spinner({ size = 18, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`animate-spin ${className}`}>
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeDasharray="42"
        strokeDashoffset="28"
        strokeLinecap="round"
      />
    </svg>
  );
}
