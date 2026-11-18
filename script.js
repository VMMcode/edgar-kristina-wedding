const envelope = document.querySelector("[data-envelope]");
const page = document.querySelector("[data-page]");
const music = document.querySelector("[data-music]");
const sound = document.querySelector("[data-sound]");

/* ===== Музыка ===== */
function updateSound() {
  const playing = !music.paused;
  sound.setAttribute("aria-pressed", String(playing));
  sound.title = playing ? "Выключить музыку" : "Включить музыку";
}

function playMusic() {
  music.play().catch(updateSound);
}

music.addEventListener("playing", updateSound);
music.addEventListener("pause", updateSound);
music.addEventListener("error", updateSound);
sound.addEventListener("click", () => {
  if (music.paused) playMusic();
  else music.pause();
});
sound.hidden = false;

/* ===== Открытие конверта ===== */
const openButton = envelope.querySelector("[data-envelope-open]");
const skipButton = envelope.querySelector("[data-envelope-skip]");
const video = envelope.querySelector("[data-envelope-video]");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let videoStartTimer;
let opening = false;
let leaving = false;

// Загружаем фон и шрифты заранее, пока гость смотрит конверт.
const heroBackground = new Image();
heroBackground.src = "img/hero-frame.webp?v=20261119-7";
heroBackground.decode().catch(() => {});

function showInvitation() {
  if (leaving) return;
  leaving = true;
  window.clearTimeout(videoStartTimer);

  // Видео продолжает раскрываться во время растворения.
  envelope.classList.add("is-leaving");
  document.documentElement.classList.add("is-invitation-revealing");

  function finishOpening() {
    if (envelope.hidden) return;
    video.pause();
    envelope.hidden = true;
    page.inert = false;
    document.documentElement.classList.remove("is-envelope-open", "is-invitation-revealing");
    document.getElementById("hero-title").focus({ preventScroll: true });
  }

  if (reduceMotion.matches) {
    finishOpening();
    return;
  }
  envelope.addEventListener("transitionend", (event) => {
    if (event.target === envelope && event.propertyName === "opacity") finishOpening();
  });
  // Запасной путь для вкладки, в которой transitionend не пришёл.
  window.setTimeout(finishOpening, 1300);
}

video.addEventListener("playing", () => window.clearTimeout(videoStartTimer));
video.addEventListener("waiting", () => {
  if (!opening || leaving) return;
  window.clearTimeout(videoStartTimer);
  videoStartTimer = window.setTimeout(showInvitation, 8000);
});
// Начинаем переход на шестой секунде, не ждём окончания ролика.
video.addEventListener("timeupdate", () => {
  if (opening && !leaving && video.currentTime >= 6) showInvitation();
});
video.addEventListener("ended", showInvitation);
video.addEventListener("error", () => {
  if (opening) showInvitation();
});
skipButton.addEventListener("click", showInvitation);

openButton.addEventListener("click", () => {
  // Оба воспроизведения запускаются непосредственно по нажатию гостя.
  playMusic();
  opening = true;
  openButton.disabled = true;

  if (reduceMotion.matches || video.error) {
    showInvitation();
    return;
  }

  skipButton.hidden = false;
  videoStartTimer = window.setTimeout(showInvitation, 12000);
  video.play().catch(showInvitation);
}, { once: true });

envelope.hidden = false;
page.inert = true;
document.documentElement.classList.add("is-envelope-open");

/* ===== Появление секций ===== */
if ("IntersectionObserver" in window && !reduceMotion.matches) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(({ isIntersecting, target }) => {
      if (!isIntersecting) return;
      target.classList.add("is-visible");
      observer.unobserve(target);
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -24px 0px" });

  document.querySelectorAll("[data-reveal]").forEach((el) => {
    el.classList.add("is-reveal-ready");
    revealObserver.observe(el);
  });
}

/* ===== Акцент времени рядом с центром экрана ===== */
const timeline = document.querySelector(".timeline");
const stages = [...document.querySelectorAll(".timeline__item")];
if (timeline && stages.length && !reduceMotion.matches) {
  timeline.classList.add("is-timing-ready");
  let activeStage;
  let timingFrame = 0;
  function updateActiveStage() {
    timingFrame = 0;
    const center = window.innerHeight / 2;
    const bounds = timeline.getBoundingClientRect();
    if (bounds.bottom < 0 || bounds.top > window.innerHeight) return;
    const nearest = stages.reduce((best, stage) => {
      const rect = stage.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - center);
      return distance < best.distance ? { stage, distance } : best;
    }, { stage: stages[0], distance: Infinity }).stage;
    if (nearest === activeStage) return;
    activeStage?.classList.remove("is-active");
    nearest.classList.add("is-active");
    activeStage = nearest;
  }
  function scheduleTiming() {
    if (!timingFrame) timingFrame = requestAnimationFrame(updateActiveStage);
  }
  window.addEventListener("scroll", scheduleTiming, { passive: true });
  window.addEventListener("resize", scheduleTiming);
  scheduleTiming();
}

/* ===== Анкета гостя ===== */
const rsvp = document.querySelector("[data-rsvp-deadline]");

if (rsvp) {
  const deadline = new Date(rsvp.dataset.rsvpDeadline).getTime();
  const form = rsvp.querySelector("[data-rsvp-form]");
  const closedMessage = rsvp.querySelector("[data-rsvp-closed]");
  const followup = rsvp.querySelector("[data-rsvp-followup]");
  const status = rsvp.querySelector("[data-rsvp-status]");
  const success = rsvp.querySelector("[data-rsvp-success]");
  const submitButton = form.querySelector(".rsvp__submit");
  const nameField = form.elements.namedItem("name");

  /* --- Срок приёма --- */
  function closeRsvp(moveFocus = false) {
    form.hidden = true;
    closedMessage.hidden = false;
    if (moveFocus) closedMessage.focus();
  }

  function watchRsvpDeadline() {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      closeRsvp(form.contains(document.activeElement));
      return;
    }

    // Длинный срок разбиваем на интервалы, допустимые для setTimeout.
    window.setTimeout(watchRsvpDeadline, Math.min(remaining, 2_147_483_647));
  }

  /* --- Вопросы о сопровождающих --- */
  function updateRsvpQuestions() {
    const declined = form.elements.namedItem("attending").value === "no";
    followup.hidden = false;
    followup.disabled = declined;
  }

  form.addEventListener("change", (event) => {
    if (event.target.name === "attending") updateRsvpQuestions();
  });

  /* --- Отправка анкеты --- */
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitButton.disabled) return;

    if (Date.now() >= deadline) {
      closeRsvp(true);
      return;
    }

    const data = new FormData(form);
    const name = data.get("name").trim();
    if (!name) {
      status.textContent = "Укажите ваше имя и фамилию.";
      nameField.focus();
      return;
    }

    const attending = data.get("attending") === "yes";
    const payload = {
      name,
      attending,
      companionNames: attending ? data.get("companionNames").trim() : "",
      hasChildren: attending ? data.get("hasChildren") === "yes" : null,
    };

    submitButton.disabled = true;
    submitButton.textContent = "Отправляем…";
    status.textContent = "";

    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null);

      if (response.status === 403 && result?.code === "RSVP_CLOSED") {
        closeRsvp(true);
        return;
      }

      if (!response.ok || result?.ok !== true) throw new Error("RSVP save failed");

      form.reset();
      updateRsvpQuestions();
      if (typeof success.showModal === "function") success.showModal();
      else status.textContent = "Спасибо за ответ! Эдгар и Кристина уже знают о вашем решении.";
    } catch {
      status.textContent = "Не удалось отправить ответ. Пожалуйста, попробуйте ещё раз чуть позже.";
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Отправить";
    }
  });

  updateRsvpQuestions();
  form.hidden = Date.now() >= deadline;
  watchRsvpDeadline();
}

/* ===== Отсчёт до свадьбы ===== */
const countdown = document.querySelector("[data-wedding-datetime]");

if (countdown) {
  const weddingTime = Date.parse(countdown.dataset.weddingDatetime);
  const timer = countdown.querySelector(".countdown__timer");
  const plural = new Intl.PluralRules("ru");
  const units = Object.entries({
    days: { seconds: 86_400, labels: { one: "день", few: "дня", many: "дней" } },
    hours: { seconds: 3_600, labels: { one: "час", few: "часа", many: "часов" } },
    minutes: { seconds: 60, labels: { one: "минута", few: "минуты", many: "минут" } },
    seconds: { seconds: 1, labels: { one: "секунда", few: "секунды", many: "секунд" } },
  }).map(([name, unit]) => {
    const element = timer.querySelector(`[data-unit="${name}"]`);
    const spokenElement = document.createElement("span");
    spokenElement.className = "countdown__spoken";
    const digitsElement = document.createElement("span");
    digitsElement.className = "countdown__digits";
    digitsElement.setAttribute("aria-hidden", "true");
    element.querySelector(".countdown__value").append(spokenElement, digitsElement);
    return {
      ...unit,
      spokenElement,
      digitsElement,
      labelElement: element.querySelector(".countdown__label"),
    };
  });

  /* --- Смена цифр сверху вниз --- */
  function updateCountdownDigits({ spokenElement, digitsElement }, digits) {
    if (spokenElement.textContent === digits) return;
    spokenElement.textContent = digits;

    if (digitsElement.children.length !== digits.length) {
      const slots = Array.from(digits, () => {
        const slot = document.createElement("span");
        slot.className = "countdown__digit";
        return slot;
      });
      digitsElement.replaceChildren(...slots);
    }

    Array.from(digits).forEach((digit, index) => {
      const slot = digitsElement.children[index];
      const previous = slot.lastElementChild;
      if (previous?.textContent === digit) return;

      const next = document.createElement("span");
      next.textContent = digit;

      if (previous && !reduceMotion.matches) {
        previous.className = "is-leaving";
        next.className = "is-entering";
        slot.replaceChildren(previous, next);
      } else {
        slot.replaceChildren(next);
      }
    });
  }

  function updateCountdown() {
    const milliseconds = Math.max(0, weddingTime - Date.now());
    let remaining = Math.ceil(milliseconds / 1000);

    units.forEach((unit) => {
      const value = Math.floor(remaining / unit.seconds);
      remaining %= unit.seconds;
      const digits = String(value).padStart(2, "0");
      const label = unit.labels[plural.select(value)];
      updateCountdownDigits(unit, digits);
      if (unit.labelElement.textContent !== label) unit.labelElement.textContent = label;
    });

    if (milliseconds > 0) window.setTimeout(updateCountdown, milliseconds % 1000 || 1000);
  }

  updateCountdown();
  timer.hidden = false;
}
