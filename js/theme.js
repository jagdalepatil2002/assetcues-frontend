/**
 * Assetcues — Shared Tailwind Config & Theme
 * Loaded before tailwind CDN processes classes.
 */
tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "surface-tint": "#005fac",
        "on-primary-fixed": "#001c39",
        "surface-container": "#eeeeee",
        "on-secondary-fixed": "#001c39",
        "surface-container-high": "#e8e8e8",
        "outline": "#717784",
        "on-primary-container": "#fefcff",
        "on-tertiary": "#ffffff",
        "on-tertiary-fixed-variant": "#753400",
        "on-background": "#1a1c1c",
        "surface-bright": "#f9f9f9",
        "secondary-container": "#b9d3fe",
        "on-surface": "#1a1c1c",
        "inverse-surface": "#2f3131",
        "surface-variant": "#e2e2e2",
        "on-tertiary-container": "#fffcff",
        "background": "#f9f9f9",
        "tertiary-fixed-dim": "#ffb68b",
        "surface-container-highest": "#e2e2e2",
        "on-surface-variant": "#414752",
        "error-container": "#ffdad6",
        "surface-dim": "#dadada",
        "primary-fixed": "#d4e3ff",
        "surface-container-low": "#f3f3f3",
        "on-secondary": "#ffffff",
        "primary-fixed-dim": "#a4c9ff",
        "tertiary": "#964500",
        "tertiary-container": "#bc5800",
        "on-error-container": "#93000a",
        "on-error": "#ffffff",
        "surface": "#f9f9f9",
        "outline-variant": "#c0c7d4",
        "inverse-primary": "#a4c9ff",
        "surface-container-lowest": "#ffffff",
        "primary-container": "#0176d3",
        "inverse-on-surface": "#f1f1f1",
        "secondary-fixed": "#d4e3ff",
        "error": "#ba1a1a",
        "primary": "#005da9",
        "secondary": "#466084",
        "on-primary-fixed-variant": "#004884",
        "on-tertiary-fixed": "#321200",
        "on-secondary-container": "#415b7f",
        "tertiary-fixed": "#ffdbc8",
        "on-primary": "#ffffff",
        "secondary-fixed-dim": "#adc8f2",
        "on-secondary-fixed-variant": "#2d486b",
        "on-primary-fixed-variant": "#3f465c",
        "on-tertiary-fixed-variant": "#005236",
        "on-tertiary-container": "#009668",
        "tertiary-fixed": "#6ffbbe",
        "tertiary-fixed-dim": "#4edea3",
      },
      fontFamily: {
        "headline": ["Manrope"],
        "body": ["Inter"],
        "label": ["Inter"]
      },
      borderRadius: {
        "DEFAULT": "0.125rem",
        "lg": "0.25rem",
        "xl": "0.5rem",
        "full": "0.75rem"
      }
    }
  }
};
