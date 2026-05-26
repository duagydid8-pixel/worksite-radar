export interface Size {
  width: number;
  height: number;
}

export interface PptImagePlacement {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const WIDE_PPT_SLIDE: Size = {
  width: 13.333,
  height: 7.5,
};

export function fitImageIntoSlide(image: Size, slide: Size = WIDE_PPT_SLIDE, margin = 0.18): PptImagePlacement {
  const imageWidth = Math.max(image.width, 1);
  const imageHeight = Math.max(image.height, 1);
  const availableWidth = Math.max(slide.width - margin * 2, 1);
  const availableHeight = Math.max(slide.height - margin * 2, 1);
  const imageRatio = imageWidth / imageHeight;

  let w = availableWidth;
  let h = w / imageRatio;
  if (h > availableHeight) {
    h = availableHeight;
    w = h * imageRatio;
  }

  return {
    x: (slide.width - w) / 2,
    y: margin,
    w,
    h,
  };
}
