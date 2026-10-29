// Explicit test entry-point only. Production start never loads this module.
if (process.env.HALQA_TEST_CLOCK) {
  const url = new URL(process.env.DATABASE_URL);
  if (
    process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !/test/i.test(url.pathname)
  )
    throw Error(
      "School clock requires a matching isolated local test database",
    );
  const RealDate = Date,
    realNow = RealDate.now.bind(RealDate),
    started = realNow();
  const epoch = RealDate.parse(process.env.HALQA_TEST_CLOCK);
  if (!Number.isFinite(epoch)) throw Error("Invalid test clock");
  const now = () => epoch + realNow() - started;
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length ? args : [now()], newTarget);
    },
    apply() {
      return new RealDate(now()).toString();
    },
    get(target, key, receiver) {
      return key === "now" ? now : Reflect.get(target, key, receiver);
    },
  });
}
