import { BASE, BOTTOM_HEAD, BOTTOM_LINE, TOP_HEAD, TOP_LINE, WIDTH } from './handOverShapes.js';

export interface HandOverArrowsProps {
  topHead?: string;
  bottomHead?: string;
  topLine?: string;
  bottomLine?: string;
  width?: number;
  topDash?: string;
  bottomDash?: string;
  topOpacity?: number;
  bottomOpacity?: number;
}

/** The two opposite arrows of the hand-over icon; each one can be dashed or drawn lighter on its own. */
export function HandOverArrows({ topHead = TOP_HEAD, bottomHead = BOTTOM_HEAD, topLine = TOP_LINE, bottomLine = BOTTOM_LINE, width = WIDTH, topDash, bottomDash, topOpacity = 1, bottomOpacity = 1 }: HandOverArrowsProps) {
  return (
    <>
      <g {...BASE} strokeWidth={width} opacity={topOpacity}>
        <path d={topHead} />
        <path d={topLine} {...(topDash === undefined ? {} : { strokeDasharray: topDash })} />
      </g>
      <g {...BASE} strokeWidth={width} opacity={bottomOpacity}>
        <path d={bottomHead} />
        <path d={bottomLine} {...(bottomDash === undefined ? {} : { strokeDasharray: bottomDash })} />
      </g>
    </>
  );
}
