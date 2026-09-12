import type { Preview } from "@storybook/react-vite";

const preview: Preview = {
  parameters: {
    actions: { disable: true },
    backgrounds: { disable: true },
    controls: {
      expanded: true,
      sort: "requiredFirst",
    },
    layout: "fullscreen",
    options: {
      storySort: {
        order: ["Character Animation Lab", ["Overview", "Actions", "Transitions"]],
      },
    },
  },
};

export default preview;
