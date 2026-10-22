import { describe, expect, it, vi } from "vitest";
import { BikeMiBrowser } from "../src/bikemi.js";

describe("BikeMi OTP submission", () => {
  it("fills the OTP and waits for BikeMi's automatic submission", async () => {
    const fill = vi.fn().mockResolvedValue(undefined);
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const getByLabel = vi.fn().mockReturnValue({ fill });
    const locator = vi.fn().mockReturnValue({ waitFor });
    const page = { getByLabel, locator };

    await new BikeMiBrowser("data/test-sessions").submitOtp(page as never, "1234");

    expect(fill).toHaveBeenCalledWith("1234");
    expect(locator).toHaveBeenCalledWith("form#enter-code-form");
    expect(waitFor).toHaveBeenCalledWith({ state: "detached", timeout: 15_000 });
  });
});
