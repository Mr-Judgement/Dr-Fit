
document.addEventListener("DOMContentLoaded", function () {
  // Load saved progress on page load
  const savedProgress = JSON.parse(localStorage.getItem("quizProgress"));
  
  const genderSelectorWrap = document.querySelector(".form_step_wrap.gender_selector");
  const maleWrap = document.querySelector(".form_step_wrap.male");
  const femaleWrap = document.querySelector(".form_step_wrap.female");
  const contactWrap = document.querySelector(".form_step_wrap.contact");

  let currentStep = 0;
  let isTransitioning = false;
  let steps = [];
  let selectedPath = null;
  let timer = null;
  let currentBodyType = null;
  let historyStack = []; // Stores game states

  // Reset quiz completely when clicking nav logo
  document.querySelector(".nav_logo")?.addEventListener("click", function (e) {
    e.preventDefault();

    // Clear progress & history
    localStorage.removeItem("quizProgress");
    historyStack = [];
    selectedPath = null;
    currentBodyType = null;

    // Reset to gender selector first step
    toggleFormWrapVisibility(genderSelectorWrap);
    steps = Array.from(genderSelectorWrap.querySelectorAll(".form_step"));
    currentStep = 0;
    showStep(0, false);
  });

  const prevButtons = document.querySelectorAll(".quiz_nav_prev");

  if (savedProgress) {
    selectedPath = savedProgress.selectedPath;
    currentBodyType = savedProgress.currentBodyType;

    // Restore correct flow
    if (selectedPath === "male") {
      toggleFormWrapVisibility(maleWrap);
      steps = Array.from(maleWrap.querySelectorAll(".form_step"));
    } else if (selectedPath === "female") {
      toggleFormWrapVisibility(femaleWrap);
      steps = Array.from(femaleWrap.querySelectorAll(".form_step"));
    } else {
      toggleFormWrapVisibility(genderSelectorWrap);
      steps = Array.from(genderSelectorWrap.querySelectorAll(".form_step"));
    }

    // If body type was selected, load that branch
    if (currentBodyType) {
      const wrapper = selectedPath === "male" ? maleWrap : femaleWrap;
      const branchWrap = wrapper.querySelector(`.body_type.${currentBodyType}`);
      if (branchWrap) {
        steps = Array.from(branchWrap.querySelectorAll(".form_step"));
      }
    }

    // Restore last step
    currentStep = savedProgress.currentStep || 0;
    showStep(currentStep, false);
  } else {
    // No saved progress, start fresh
    toggleFormWrapVisibility(genderSelectorWrap);
    steps = Array.from(genderSelectorWrap.querySelectorAll(".form_step"));
    showStep(0);
  }

  function saveState() {
    const state = {
      selectedPath,
      currentBodyType,
      currentStep,
      stepsSelector: steps.map(step => step.id || step.getAttribute("data-step-id")),
      inputs: Array.from(document.querySelectorAll("input, select, textarea")).map(el => ({
        selector: getUniqueSelector(el),
        value: el.type === "checkbox" || el.type === "radio" ? el.checked : el.value
      }))
    };
    historyStack.push(state);
  }

  // helper: is this step "radio-only" (contains radios, no checkboxes) and has no Next button?
function isRadioOnlyStep(step) {
  if (!step) return false;
  const hasNextBtn = !!step.querySelector('.quiz_btn');
  const radios = step.querySelectorAll('input[type="radio"]');
  const checkboxes = step.querySelectorAll('input[type="checkbox"]');
  return !hasNextBtn && radios.length > 0 && checkboxes.length === 0;
}

function restoreState(state) {
  if (!state) return;

  selectedPath = state.selectedPath;
  currentBodyType = state.currentBodyType;

  // Render the correct flow/layout first (this may clone/replace nodes)
  if (selectedPath === "male") {
    toggleFormWrapVisibility(maleWrap);
    steps = Array.from(maleWrap.querySelectorAll(".form_step"));
  } else if (selectedPath === "female") {
    toggleFormWrapVisibility(femaleWrap);
    steps = Array.from(femaleWrap.querySelectorAll(".form_step"));
  } else {
    toggleFormWrapVisibility(genderSelectorWrap);
    steps = Array.from(genderSelectorWrap.querySelectorAll(".form_step"));
  }

  if (currentBodyType) {
    const wrapper = selectedPath === "male" ? maleWrap : femaleWrap;
    const branchWrap = wrapper.querySelector(`.body_type.${currentBodyType}`);
    if (branchWrap) {
      steps = Array.from(branchWrap.querySelectorAll('.form_step'));
    }
  }

  // Show the step (do NOT try to save while restoring)
  currentStep = state.currentStep || 0;
  showStep(currentStep, false);

  // Active step and helper flags
  const active = steps[currentStep];
  const activeIsRadioOnly = isRadioOnlyStep(active);

  // slider IDs/classes to protect from replacement/reset
  const SLIDER_IDS = ['maleweightSlider','malegoalWeightSlider','weightSlider','goalWeightSlider'];

  // 1) Restore saved values for everything EXCEPT radios inside the active radio-only step
  const restoredEls = [];
  (state.inputs || []).forEach(inputData => {
    const el = document.querySelector(inputData.selector);
    if (!el) return;

    // Protect slider/persistent controls from accidental reset:
    const isSliderControl = (el.tagName.toUpperCase() === 'INPUT' && (el.classList.contains('slider') || el.type === 'range')) ||
                            (el.id && SLIDER_IDS.includes(el.id));

    // If this element is inside the active radio-only step and is a radio, skip restoring it
    if (activeIsRadioOnly && active && active.contains(el) && el.type === 'radio') {
      return;
    }

    if (isSliderControl) {
      // Only set value if different to avoid resetting native visuals
      if (typeof inputData.value !== 'undefined' && String(el.value) !== String(inputData.value)) {
        el.value = inputData.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      restoredEls.push(el);
      return;
    }

    if (el.type === "checkbox" || el.type === "radio") {
      el.checked = !!inputData.value;
      try { el.defaultChecked = !!inputData.value; } catch (e) {}
    } else {
      el.value = inputData.value;
    }

    restoredEls.push(el);
  });

  // 2) Sync visuals now that we've restored the non-skipped inputs
  syncInputVisuals();

  // 3) If active step is radio-only: clear its radios AFTER the DOM fully stabilizes.
  //    Use two requestAnimationFrame calls to ensure we run after repaint / after any DOM cloning.
  if (activeIsRadioOnly && active) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const radios = Array.from(active.querySelectorAll('input[type="radio"]'));
        radios.forEach(r => {
          r.checked = false;
          try { r.defaultChecked = false; } catch (e) {}
          // Dispatch change so delegated handlers run and visuals update
          r.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // Re-sync visuals after clearing
        syncInputVisuals();

        // Adjust parent height in case clearing changed layout
        const parentWrap = active.closest('.form_step_wrap');
        if (parentWrap) parentWrap.style.height = active.offsetHeight + 'px';
      });
    });
  }

  // 4) Dispatch input/change events for restored elements (skip radios inside active radio-only)
  restoredEls.forEach(el => {
    // skip radios that belong to active radio-only (shouldn't be here, but guard)
    if (activeIsRadioOnly && active && active.contains(el) && el.type === 'radio') return;
    try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch(e){}
    try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch(e){}
  });

  // 5) Ensure wrapper height for non-radio-only steps
  if (!activeIsRadioOnly && active) {
    const parentWrap = active.closest('.form_step_wrap');
    if (parentWrap) parentWrap.style.height = active.offsetHeight + 'px';
  }
}



  function getUniqueSelector(el) {
    if (el.id) return `#${el.id}`;
    if (el.name) return `[name="${el.name}"]`;
    return el.tagName.toLowerCase() + (el.className ? '.' + el.className.trim().replace(/\s+/g, '.') : '');
  }

  function setStepFlow(path) {
    saveState(); // keep previous path in history

    selectedPath = path;
    if (path === "male") {
      toggleFormWrapVisibility(maleWrap);
      steps = Array.from(maleWrap.querySelectorAll(".form_step"));
    } else if (path === "female") {
      toggleFormWrapVisibility(femaleWrap);
      steps = Array.from(femaleWrap.querySelectorAll(".form_step"));
    }
    currentStep = 0;
    showStep(currentStep);
  }

  function toggleFormWrapVisibility(activeWrap) {
    [genderSelectorWrap, maleWrap, femaleWrap, contactWrap].forEach(wrap => {
      if (wrap === activeWrap) {
        wrap.style.display = "block";
      } else {
        wrap.style.display = "none";
        wrap.style.height = "0px";
      }
    });
  }

  function updateProgressBar() {
    const totalSteps = steps.length;
    const progress = ((currentStep + 1) / totalSteps) * 100;
    const progressFill = document.querySelector(".progress_bar");
    if (progressFill) {
      progressFill.style.width = progress + "%";
    }
  }

  function showStep(index, saveHistory = true) {
    if (isTransitioning) return;
    isTransitioning = true;

    if (saveHistory) saveState();

    // Save progress to localStorage whenever you change steps
    localStorage.setItem("quizProgress", JSON.stringify({
      selectedPath,
      currentBodyType,
      currentStep: index
    }));

    clearTimeout(timer);
    removeAllEventListeners();

    const currentActive = document.querySelector(".form_step.active");

    if (currentActive && steps[index] !== currentActive) {
      setTimeout(() => {
        currentActive.classList.add("exiting");
        currentActive.classList.remove("active");

        setTimeout(() => {
          currentActive.classList.remove("exiting");
          activateNewStep(index);
          isTransitioning = false;
        }, 400);
      }, 200);
    } else {
      activateNewStep(index);
      isTransitioning = false;
    }
  }

  function activateNewStep(index) {
    document.querySelectorAll(".form_step").forEach(step => {
      step.classList.remove("active", "exiting");
    });

    if (steps[index]) {
      steps[index].classList.add("active");
      currentStep = index;
      handleStepBehavior(steps[currentStep]);
      updateProgressBar();

      const parentWrap = steps[index].closest('.form_step_wrap');
      if (parentWrap) {
        parentWrap.style.height = steps[index].offsetHeight + 'px';
      }

      // 🎉 Trigger confetti if this step has confetti="true"
      if (steps[index].hasAttribute("confetti")) {
        launchConfetti?.();
      }
    }
  }

  // Weight recommendation helpers
  function getNumericValue(el) {
    if (!el) return NaN;
    const rawValue = String(el.value);
    const cleaned = rawValue.replace(/[^\d.]/g, "");
    return parseFloat(cleaned);
  }

  function updateWeightRecommendation(gender) {
    let currentSlider, goalSlider;

    if (gender === "male") {
      currentSlider = document.getElementById('maleweightSlider');
      goalSlider = document.getElementById('malegoalWeightSlider');
    } else if (gender === "female") {
      currentSlider = document.getElementById('weightSlider');        
      goalSlider = document.getElementById('goalWeightSlider');       
    }

    const current = getNumericValue(currentSlider);
    const goal = getNumericValue(goalSlider);

    if (isNaN(current) || isNaN(goal) || current <= 0) return;

    const wantsToGain = goal > current;
    const lossPercent = ((current - goal) / current) * 100;

    let recommendation = null;
    if (wantsToGain) {
      recommendation = 'skinny';
    } else if (lossPercent >= 10) {
      recommendation = 'overweight';
    } else if (lossPercent >= 1) {
      recommendation = 'soft';
    }

    document.querySelectorAll(`.form_step[body-goal="${gender}"]`).forEach(step => {
      step.querySelectorAll('.goal_choice_option').forEach(opt => {
        opt.classList.remove('is--recommended');

        // Hide all recommended_text initially
        const recText = opt.querySelector('.recommended_text');
        if (recText) {
          recText.style.display = "none";
        }
      });

      if (recommendation) {
        const label = step.querySelector(`.goal_choice_option[recommendation="${recommendation}"]`);
        const recText = label?.querySelector('.recommended_text');
        if (recText) {
          recText.style.display = "block";
        }
      }
    });
  }

  document.getElementById('maleweightSlider')?.addEventListener('input', () => updateWeightRecommendation('male'));
  document.getElementById('malegoalWeightSlider')?.addEventListener('input', () => updateWeightRecommendation('male'));
  document.getElementById('weightSlider')?.addEventListener('input', () => updateWeightRecommendation('female'));
  document.getElementById('goalWeightSlider')?.addEventListener('input', () => updateWeightRecommendation('female'));
  updateWeightRecommendation('male');
  updateWeightRecommendation('female');

  // Event handler logic
  function handleStepBehavior(step) {
    const nextBtn = step.querySelector(".quiz_btn");
    const hasBtn = !!nextBtn;

    if (step.id === "select-gender") {
      const genderRadios = step.querySelectorAll('input[gender-path]');
      genderRadios.forEach(radio => {
        radio.addEventListener("click", function () {
          if (radio.checked) {
            const path = radio.getAttribute("gender-path");
            if (path === "male" || path === "female") {
              selectedPath = path;
              setStepFlow(selectedPath);
            }
          }
        });
        radio.setAttribute("data-listening", "true");
      });
    }
    else if (step.getAttribute("option-choice") === "true") {
      const nextHandler = () => {
        const selected = step.querySelector('input[data-option]:checked');
        if (selected && !isTransitioning) {
          nextBtn.removeEventListener("click", nextHandler);
          const selectedOption = selected.getAttribute("data-option");

          const currentWrap = selectedPath === "male" ? maleWrap : femaleWrap;
          let newSteps = Array.from(currentWrap.querySelectorAll('.form_step'));
          
          if (currentBodyType) {
            const bodyTypeWrap = currentWrap.querySelector(`.body_type.${currentBodyType}`);
            if (bodyTypeWrap) {
              newSteps = Array.from(bodyTypeWrap.querySelectorAll('.form_step'));
            }
          }
          
          newSteps = newSteps.filter(s => {
            const revealAttr = s.getAttribute("option-reveal");
            return !revealAttr || revealAttr === selectedOption;
          });

          steps = newSteps;
          currentStep = steps.indexOf(step) + 1;
          showStep(currentStep);
        }
      };

      if (nextBtn) {
        nextBtn.addEventListener("click", nextHandler);
        nextBtn.setAttribute("data-listening", "true");
      }
    }
    else if (step.getAttribute("body-goal")) {
      updateWeightRecommendation();
      const gender = step.getAttribute("body-goal");
      const nextHandler = () => {
        const selected = step.querySelector('input[body-type]:checked');
        if (selected && !isTransitioning) {
          saveState(); // ensure we can go back to body-goal step later

          nextBtn.removeEventListener("click", nextHandler);
          currentBodyType = selected.getAttribute("body-type");
          const wrapper = gender === "male" ? maleWrap : femaleWrap;
          const branchWrap = wrapper.querySelector(`.body_type.${currentBodyType}`);
          
          if (branchWrap) {
            steps = Array.from(branchWrap.querySelectorAll('.form_step'));
            currentStep = 0;
            showStep(currentStep);
          }
        }
      };

      if (nextBtn) {
        nextBtn.addEventListener("click", nextHandler);
        nextBtn.setAttribute("data-listening", "true");
      }
    }

    else if (!hasBtn) {
      const radios = step.querySelectorAll("input[type='radio'], input[type='checkbox']");
      radios.forEach(radio => {
        radio.addEventListener("change", () => {
          if (radio.checked && !isTransitioning) {
            goToNextStep();
          }
        });
        radio.setAttribute("data-listening", "true");
      });
    }
    else if (hasBtn) {
      const radios = step.querySelectorAll("input[type='radio'], input[type='checkbox']");
      const handler = () => {
        const anySelected = Array.from(radios).some(input => input.checked);
        if (anySelected && !isTransitioning) {
          nextBtn.removeEventListener("click", handler);
          goToNextStep();
        }
      };

      if (radios.length > 0) {
        nextBtn.addEventListener("click", handler);
        nextBtn.setAttribute("data-listening", "true");
      } else {
        const fallbackHandler = () => {
          if (!isTransitioning) {
            nextBtn.removeEventListener("click", fallbackHandler);
            goToNextStep();
          }
        };
        nextBtn.addEventListener("click", fallbackHandler);
        nextBtn.setAttribute("data-listening", "true");
      }
    }

    if (!hasBtn && 
        !step.querySelector("input[type='radio'], input[type='checkbox']") && 
        step.id !== "select-gender" && 
        step.getAttribute("option-choice") !== "true" && 
        !step.getAttribute("body-goal")) {
      const delay = parseInt(step.getAttribute("data-delay")) || 2500;
      timer = setTimeout(() => {
        if (!isTransitioning) goToNextStep();
      }, delay);
    }
  }

   // --- helper: sync visuals for radio/checkbox options & faux knobs ---
function syncInputVisuals() {
  // 1) Reset all option visuals to default
  document.querySelectorAll('.frustrations_option, .goal_choice_option, .workout_option').forEach(option => {
    option.style.backgroundColor = ''; // allow CSS to handle default, fallback '#f4f4f4' if needed
    option.style.color = '';
  });

  // 2) For every input checked, set its parent option visuals
  document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
    const parentOption = input.closest('.frustrations_option') || input.closest('.goal_choice_option') || input.closest('.workout_option');
    if (parentOption) {
      if (input.checked) {
        parentOption.style.backgroundColor = 'black';
        parentOption.style.color = 'white';
      } else {
        // leave default (cleared above)
      }
    }

    // Also ensure faux knobs reflect checked state (if present)
    const label = input.closest('label');
    if (label) {
      const knob = label.querySelector('.faux_radio_btn_knob');
      if (knob) knob.style.backgroundColor = input.checked ? '#ad1a1a' : '';
    }
  });
}

// Ensure we also respond to future changes via a single delegated listener.
// (Extend or replace any previous per-input radio change handlers.)
document.removeEventListener?.('change', window.__sync_input_visuals_change_handler__); // try remove old if exists
window.__sync_input_visuals_change_handler__ = function (ev) {
  const t = ev.target;
  if (!t || !(t.matches && (t.matches('input[type="radio"]') || t.matches('input[type="checkbox"]')))) return;
  // Update visuals for the whole group (clears & reapplies)
  syncInputVisuals();
};
document.addEventListener('change', window.__sync_input_visuals_change_handler__, { capture: false });


// --- updated removeAllEventListeners: replace nodes but then resync visuals ---
function removeAllEventListeners() {
  // IDs/classes we consider "persistent" controls that must NOT be replaced
  const SLIDER_IDS = new Set([
    'maleweightSlider',
    'malegoalWeightSlider',
    'weightSlider',
    'goalWeightSlider'
  ]);

  document.querySelectorAll("[data-listening='true']").forEach(el => {
    const tag = el.tagName.toUpperCase();

    // Decide if this element is a slider / persistent control we should not replace
    const isSliderControl = (tag === 'INPUT' && (el.classList.contains('slider') || el.type === 'range')) ||
                            (el.id && SLIDER_IDS.has(el.id));

    // If it's a slider/persistent control: don't replace it (preserve listeners & native UI)
    if (isSliderControl) {
      // Remove the data-listening marker so future runs won't try to replace it again
      // but keep the element and its event listeners intact.
      el.removeAttribute('data-listening');
      return;
    }

    // For other nodes, capture state and replace with a clean clone to remove attached listeners
    const state = {};

    if (tag === 'INPUT') {
      state.type = el.type;
      state.checked = el.checked;
      state.value = el.value;
    } else if (tag === 'TEXTAREA') {
      state.value = el.value;
    } else if (tag === 'SELECT') {
      state.selectedIndex = el.selectedIndex;
      state.selectedOptions = Array.from(el.options).map(o => o.selected);
    }

    const clone = el.cloneNode(true);

    // Restore state onto clone
    if (tag === 'INPUT') {
      if (clone.type === 'checkbox' || clone.type === 'radio') {
        try { clone.checked = !!state.checked; } catch (e) {}
      }
      if (typeof state.value !== 'undefined') clone.value = state.value;
    } else if (tag === 'TEXTAREA') {
      clone.value = state.value;
    } else if (tag === 'SELECT') {
      if (typeof state.selectedIndex !== 'undefined') clone.selectedIndex = state.selectedIndex;
      if (Array.isArray(state.selectedOptions)) {
        Array.from(clone.options).forEach((opt, i) => {
          opt.selected = !!state.selectedOptions[i];
        });
      }
    }

    // Replace the node (now without event listeners) but with preserved state
    if (el.parentNode) {
      el.parentNode.replaceChild(clone, el);
    }
  });

  // After replacements, ensure visuals match the input state
  syncInputVisuals();
}

  // Single, updated goToNextStep() (no duplicates)
  function goToNextStep() {
    if (isTransitioning) return;

    const isLast = currentStep >= steps.length - 1;

    // Normal case: move forward one step in same steps array
    if (!isLast) {
      showStep(currentStep + 1); // showStep will call saveState()
      return;
    }

    // We are ON the last step of the current steps array.
    // Only auto-route if we're inside a body_type branch and the step
    // either has no .contact_nav_btn or is explicitly marked to auto-route.
    const active = steps[currentStep];
    const inBodyTypeBranch = !!currentBodyType;
    const hasContactBtn = !!(active && active.querySelector(".contact_nav_btn"));
    const explicitlyAuto = active && active.getAttribute("data-auto-contact") === "true";

    if (inBodyTypeBranch && (explicitlyAuto || !hasContactBtn)) {
      // Preserve history so Prev works from Contact back to the last body_type slide
      try { saveState(); } catch (e) {}

      clearTimeout(timer);
      toggleFormWrapVisibility(contactWrap);
      steps = Array.from(contactWrap.querySelectorAll(".form_step"));
      currentStep = 0;
      showStep(currentStep, false); // don't push another history entry now
      return;
    }

    // Otherwise do nothing — we stay on the final slide (e.g., if it actually has its own contact button)
  }

  function goToPrevStep() {
    if (historyStack.length > 0) {
      const prevState = historyStack.pop();
      restoreState(prevState);
    } else {
      // No history, reset to gender selector
      selectedPath = null;
      currentBodyType = null;
      toggleFormWrapVisibility(genderSelectorWrap);
      steps = Array.from(genderSelectorWrap.querySelectorAll(".form_step"));
      currentStep = 0;
      showStep(currentStep, false); // Ensure first step activates without saving history
    }
  }

  prevButtons.forEach(btn => {
    btn.addEventListener("click", function () {
      if (!isTransitioning) goToPrevStep();
    });
  });

  document.querySelectorAll(".contact_nav_btn").forEach(btn => {
    btn.addEventListener("click", function () {
      toggleFormWrapVisibility(contactWrap);
      steps = Array.from(contactWrap.querySelectorAll(".form_step"));
      currentStep = 0;
      showStep(currentStep);
    });
  });
});

(function() {
  // Select all form step elements
  const formSteps = document.querySelectorAll('.form_step');
  
  // If no form steps found, exit
  if (!formSteps.length) return;
  
  // Function to prevent horizontal scrolling
  function preventHorizontalScroll(event) {
    // Check if the event is a wheel/touch event that would cause horizontal scrolling
    if (event.type === 'wheel') {
      // For wheel events (mouse wheel/trackpad)
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault();
      }
    } else if (event.type === 'touchmove') {
      // For touch events
      const touch = event.touches[0] || event.changedTouches[0];
      const startX = parseFloat(event.target.getAttribute('data-touch-start-x'));
      const deltaX = touch.clientX - startX;
      
      if (Math.abs(deltaX) > 10) { // Threshold to distinguish from vertical scroll
        event.preventDefault();
      }
    }
  }
  
  // Function to handle touch start
  function handleTouchStart(event) {
    const touch = event.touches[0];
    event.target.setAttribute('data-touch-start-x', touch.clientX);
  }
  
  // Apply to each form step
  formSteps.forEach(step => {
    // CSS solution first - more performant
    step.style.overflowX = 'hidden';
    
    // JavaScript fallbacks for more control
    step.addEventListener('wheel', preventHorizontalScroll, { passive: false });
    step.addEventListener('touchstart', handleTouchStart, { passive: true });
    step.addEventListener('touchmove', preventHorizontalScroll, { passive: false });
    
    // Additional prevention for keyboard scrolling
    step.addEventListener('scroll', function() {
      if (this.scrollLeft !== 0) {
        this.scrollLeft = 0;
      }
    });
  });
  
  // Optional: Add CSS via JavaScript for more robust prevention
  const style = document.createElement('style');
  style.textContent = `
    .form_step {
      overflow-x: hidden !important;
      overscroll-behavior-x: contain !important;
    }
  `;
  document.head.appendChild(style);
})();

//code to prevent sliders glitching
  document.querySelectorAll('.slider').forEach(slider => {
    slider.addEventListener('touchstart', (e) => {
      document.activeElement?.blur(); // blur any active slider
      setTimeout(() => {
        e.target.focus();
      }, 0);
      e.stopPropagation();
    }, { passive: true });

    slider.addEventListener('pointerdown', (e) => {
      document.activeElement?.blur();
      setTimeout(() => {
        e.target.focus();
      }, 0);
      e.stopPropagation();
    });
  });


  // Blur the slider when clicking/tapping outside of it
  document.addEventListener('pointerdown', (e) => {
    const active = document.activeElement;
    if (active && active.classList.contains('slider') && !e.target.classList.contains('slider')) {
      active.blur();
    }
  });

  // Extra: also do it for touchstart just in case
  document.addEventListener('touchstart', (e) => {
    const active = document.activeElement;
    if (active && active.classList.contains('slider') && !e.target.classList.contains('slider')) {
      active.blur();
    }
  }, { passive: true });





//little progress bars
(function() {
  // --- COLOR HELPER ---
  function getColorForPercentage(pct) {
    if (pct <= 40) {
      return "#a20000"; // Red
    } else if (pct > 40 && pct <= 65) {
      const ratio = (pct - 40) / (65 - 40);
      const r = 162 + (255 - 162) * ratio;
      const g = 0 + (255 - 0) * ratio;
      return `rgb(${Math.round(r)}, ${Math.round(g)}, 0)`;
    } else {
      const ratio = (pct - 65) / (100 - 65);
      const r = 255 - (255 * ratio);
      const g = 255 - (255 - 128) * ratio;
      return `rgb(${Math.round(r)}, ${Math.round(g)}, 0)`;
    }
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // --- PRIVATE STATE ---
  const activeAnimations = new Map();
  const resetTimers = new Map();

  // --- POPUP ---
  function showPopupForBar(bar, start, target) {
    const diff = Math.round(target - start);
    if (diff === 0) return;
    if (!bar.hasAttribute('data-bar-start')) return;

    const parent = bar.parentElement || document.body;
    const computedPos = window.getComputedStyle(parent).position;
    if (computedPos === 'static') {
      parent.dataset._bar_set_rel = 'true';
      parent.style.position = 'relative';
    }

    const popup = document.createElement('div');
    popup.className = 'popup-text';
    popup.textContent = (diff > 0 ? '+' : '') + diff + '%';
    parent.appendChild(popup);
    popup.style.animation = 'popup-pop 1.6s cubic-bezier(.22,1,.36,1) forwards';

    setTimeout(() => {
      popup.remove();
      if (parent.dataset._bar_set_rel === 'true') {
        delete parent.dataset._bar_set_rel;
        parent.style.position = '';
      }
    }, 1800);
  }

  // --- ANIMATION ---
  function animateProgressBar(bar) {
    if (activeAnimations.has(bar)) {
      activeAnimations.get(bar).cancel();
      activeAnimations.delete(bar);
    }
    if (resetTimers.has(bar)) {
      clearTimeout(resetTimers.get(bar));
      resetTimers.delete(bar);
    }

    const fill = bar.querySelector(".progress-fill");
    const text = bar.querySelector(".progress-text");
    const target = parseFloat(bar.getAttribute("data-bar-fill")) || 0;
    const hasStart = bar.hasAttribute("data-bar-start");
    const rawStart = hasStart ? parseFloat(bar.getAttribute("data-bar-start")) : 0;

    const s = Math.max(0, Math.min(100, rawStart));
    const t = Math.max(0, Math.min(100, target));
    const durationAttr = bar.getAttribute('data-duration') || bar.getAttribute('data-speed');
    const duration = durationAttr ? Math.max(150, parseFloat(durationAttr) * 1000 || parseFloat(durationAttr) || 2000) : 2000;

    fill.style.width = s + "%";
    fill.style.backgroundColor = getColorForPercentage(s);
    if (text) text.textContent = Math.round(s) + "%";

    const startTime = performance.now();
    let rafId = null;
    let cancelled = false;

    function step(now) {
      if (cancelled) return;
      const elapsed = now - startTime;
      const rawProgress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(rawProgress);
      const current = s + (t - s) * eased;

      fill.style.width = current + "%";
      fill.style.backgroundColor = getColorForPercentage(current);
      if (text) text.textContent = Math.round(current) + "%";

      if (rawProgress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        activeAnimations.delete(bar);
      }
    }

    rafId = requestAnimationFrame(step);

    activeAnimations.set(bar, {
      cancel() {
        cancelled = true;
        if (rafId) cancelAnimationFrame(rafId);
      }
    });

    if (hasStart) showPopupForBar(bar, s, t);
  }

  function resetProgressBar(bar) {
    if (activeAnimations.has(bar)) {
      activeAnimations.get(bar).cancel();
      activeAnimations.delete(bar);
    }
    if (resetTimers.has(bar)) {
      clearTimeout(resetTimers.get(bar));
      resetTimers.delete(bar);
    }

    const timeout = setTimeout(() => {
      const fill = bar.querySelector(".progress-fill");
      const text = bar.querySelector(".progress-text");
      if (fill) {
        fill.style.width = "0%";
        fill.style.backgroundColor = getColorForPercentage(0);
      }
      if (text) text.textContent = "0%";
      resetTimers.delete(bar);
    }, 300);

    resetTimers.set(bar, timeout);
  }

  // --- WATCH FOR STEP CHANGES ---
  function monitorFormSteps() {
    let lastActive = null;
    const observer = new MutationObserver(() => {
      const activeStep = document.querySelector(".form_step.active");

      if (lastActive && lastActive !== activeStep) {
        const bars = lastActive.querySelectorAll(".progress-bar");
        bars.forEach(bar => resetProgressBar(bar));
      }

      if (activeStep && activeStep !== lastActive) {
        lastActive = activeStep;
        const bars = activeStep.querySelectorAll(".progress-bar");
        bars.forEach(bar => animateProgressBar(bar));
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });

    const activeStep = document.querySelector(".form_step.active");
    if (activeStep) {
      const bars = activeStep.querySelectorAll(".progress-bar");
      bars.forEach(bar => animateProgressBar(bar));
    }
  }

  monitorFormSteps();
})();





// ==========================
// Liquid Filling Animation
// ==========================

// Generate SVG wave path
function createWavePath(width, amplitude, offsetY, phase, frequency = 2.5) {
  const points = [];
  for (let x = 0; x <= width; x++) {
    const y = amplitude * Math.sin((x / width) * frequency * 2 * Math.PI + phase) + offsetY;
    points.push([x, y]);
  }

  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i][0]} ${points[i][1]}`;
  }
  d += ` L ${width} 200 L 0 200 Z`;
  return d;
}

const activeGSAPAnimations = new Map();
const resetTimeouts = new Map();

// Animate a single liquid container by ID
function animateLiquidById(id, targetPercent) {
  const container = document.getElementById(id);
  if (!container) return;

  // Stop any previous animation for this container
  if (activeGSAPAnimations.has(id)) {
    activeGSAPAnimations.get(id)();
    activeGSAPAnimations.delete(id);
  }

  // Get starting percentage if available
  const hasStart = container.hasAttribute('data-start');
  const startPercent = hasStart ? parseInt(container.getAttribute('data-start')) || 0 : 0;

  // Define waves
  const waves = [
    { el: container.querySelector('.wave1'), amp: 8, phase: 0, speed: 0.02 },
    { el: container.querySelector('.wave2'), amp: 6, phase: 0, speed: 0.015 },
    { el: container.querySelector('.wave3'), amp: 4, phase: 0, speed: 0.01 },
    { el: container.querySelector('.wave4'), amp: 2, phase: 0, speed: 0.007 }
  ];

  const text = container.querySelector(".percent-text");
  const width = 200;
  const height = 200;
  const startOffsetY = height - (startPercent / 100) * height;
  const targetOffsetY = height - (targetPercent / 100) * height;
  const data = { percent: startPercent, offsetY: startOffsetY };
  const speed = parseFloat(container.getAttribute('data-speed')) || 2;

  // Animate percentage and wave offset
  const tween = gsap.to(data, {
    percent: targetPercent,
    offsetY: targetOffsetY,
    duration: speed,
    ease: "power3.out",
    onUpdate() {
      const currentPercent = Math.round(data.percent);
      text.textContent = `${currentPercent}%`;
      text.setAttribute("fill", "black");
    }
  });

  // Update waves every tick
  const tick = () => {
    waves.forEach(wave => {
      wave.phase += wave.speed;
      wave.el.setAttribute("d", createWavePath(width, wave.amp, data.offsetY, wave.phase));
    });
  };
  gsap.ticker.add(tick);

  // Stop animation and reset
  const stop = () => {
    tween.kill();
    gsap.ticker.remove(tick);
    text.textContent = "0%";
  };

  activeGSAPAnimations.set(id, stop);

  // Show popup only if `data-start` existed
  if (hasStart) {
    showPopup(container, startPercent, targetPercent);
  }
}

// Show popup for percentage difference
function showPopup(container, start, end) {
  const diff = end - start;
  if (diff === 0) return;

  const popup = document.createElement("div");
  popup.className = "popup-text";
  popup.textContent = (diff > 0 ? "+" : "") + diff + "%";
  container.appendChild(popup);

  gsap.fromTo(popup,
    { x: "110%", y: "0%", opacity: 0, scale: 0.8 },
    { x: "130%", y: "-40%", opacity: 1, scale: 1.2, duration: 0.6, ease: "back.out(2)" }
  );

  gsap.to(popup, {
    y: "-100%",
    opacity: 0,
    duration: 1,
    delay: 1.2,
    onComplete: () => popup.remove()
  });
}

// Monitor form steps and trigger animations
function monitorLiquidAnimations() {
  document.querySelectorAll('.form_step').forEach(formStep => {
    const isActive = formStep.classList.contains('active');
    const containers = formStep.querySelectorAll('.liquid-container');

    containers.forEach(container => {
      const id = container.id;
      const targetFill = parseInt(container.getAttribute('data-fill')) || 0;
      const wasActive = container.dataset._wasActive === 'true';

      // When step becomes active
      if (isActive && !wasActive) {
        if (resetTimeouts.has(id)) {
          clearTimeout(resetTimeouts.get(id));
          resetTimeouts.delete(id);
        }
        animateLiquidById(id, targetFill);
        container.dataset._wasActive = 'true';
      }

      // When step becomes inactive
      if (!isActive && wasActive) {
        container.dataset._wasActive = 'false';
        const timeout = setTimeout(() => {
          if (activeGSAPAnimations.has(id)) {
            activeGSAPAnimations.get(id)();
            activeGSAPAnimations.delete(id);
          }
          container.querySelector('.percent-text').textContent = '0%';
        }, 300);
        resetTimeouts.set(id, timeout);
      }
    });
  });
}

// Periodically check for active/inactive form steps
setInterval(monitorLiquidAnimations, 200);


  // Code to change Radio button color state
  document.addEventListener("DOMContentLoaded", function () {
    const radioInputs = document.querySelectorAll('input[type="radio"]');

    radioInputs.forEach(radio => {
      radio.addEventListener('change', () => {
        // Reset all options to default
        document.querySelectorAll('.frustrations_option, .goal_choice_option, .workout_option').forEach(option => {
          option.style.backgroundColor = '#f4f4f4';
          option.style.color = '#333';
        });

        // If this radio is checked, apply active styles to its parent option
        if (radio.checked) {
          const parentOption = radio.closest('.frustrations_option') || radio.closest('.goal_choice_option') || radio.closest('.workout_option');
          if (parentOption) {
            parentOption.style.backgroundColor = 'black';
            parentOption.style.color = 'white';
          }
        }
      });
    });
  });




//Safari forceful video autoplay
document.addEventListener("DOMContentLoaded", function () {
  let bgVideos = document.querySelectorAll("video");
  bgVideos.forEach(video => {
    video.setAttribute("muted", "muted");
    video.setAttribute("playsinline", "");
    video.setAttribute("autoplay", "");
    video.muted = true;
    video.play().catch(() => {
      console.log("Safari blocked autoplay. Will require user interaction.");
    });
  });
});

//confetti animation
function launchConfetti() {
  const duration = 2 * 1000; // 2 seconds
  const animationEnd = Date.now() + duration;
  const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

  function randomInRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  const interval = setInterval(function() {
    const timeLeft = animationEnd - Date.now();

    if (timeLeft <= 0) {
      return clearInterval(interval);
    }

    const particleCount = 50 * (timeLeft / duration);
    // Left burst
    confetti({
      ...defaults,
      particleCount,
      origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
    });
    // Right burst
    confetti({
      ...defaults,
      particleCount,
      origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
    });
  }, 250);
}



//Faux radio button code
document.addEventListener('DOMContentLoaded', () => {
  // safe CSS.escape fallback
  const cssEscape = (s) => {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(s);
    return String(s).replace(/([^\w-])/g, '\\$1');
  };

  // Sync initial knob state for labels that contain a .faux_radio_btn_knob
  document.querySelectorAll('label').forEach(label => {
    const knob = label.querySelector('.faux_radio_btn_knob');
    const input = label.querySelector('input[type="radio"], input[type="checkbox"]');
    if (!knob || !input) return;
    knob.style.backgroundColor = input.checked ? '#ad1a1a' : '';
  });

  // Delegated change handler — updates the knob for the changed input and the group (for radios)
  document.addEventListener('change', (ev) => {
    const input = ev.target;
    if (!input || !(input.matches('input[type="radio"], input[type="checkbox"]'))) return;

    const parentLabel = input.closest('label');
    if (parentLabel) {
      const knob = parentLabel.querySelector('.faux_radio_btn_knob');
      if (knob) knob.style.backgroundColor = input.checked ? '#ad1a1a' : '';
    }

    // If it's a radio, update all group members' knobs (ensures visuals are synced)
    if (input.type === 'radio' && input.name) {
      const group = Array.from(document.querySelectorAll(`input[type="radio"][name="${cssEscape(input.name)}"]`));
      group.forEach(r => {
        const pl = r.closest('label');
        if (!pl) return;
        const k = pl.querySelector('.faux_radio_btn_knob');
        if (k) k.style.backgroundColor = r.checked ? '#ad1a1a' : '';
      });
    }
  });

  // Delegated click handler for the visual elements (.radio_btn)
  // Uses input.click() so the browser handles group semantics and events correctly.
  document.addEventListener('click', (ev) => {
    const visual = ev.target.closest('.radio_btn');
    if (!visual) return;

    const parentLabel = visual.closest('label');
    if (!parentLabel) return;

    const input = parentLabel.querySelector('input[type="radio"], input[type="checkbox"]');
    if (!input) return;

    // Let the browser do the toggling — use click() so change events fire naturally
    ev.preventDefault();
    ev.stopPropagation();
    input.click();
  });
});



// Loading Animation Unique ID script

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".loading-icon").forEach((svg, index) => {
    const gradient = svg.querySelector("linearGradient");
    if (gradient && gradient.id) {
      // Generate unique ID
      const uniqueId = gradient.id + "_" + index;

      // Update gradient ID
      gradient.id = uniqueId;

      // Only update stroke references that use this gradient
      svg.querySelectorAll("[stroke]").forEach(el => {
        const stroke = el.getAttribute("stroke");
        if (stroke && stroke.includes(`url(#`)) {
          el.setAttribute("stroke", `url(#${uniqueId})`);
        }
      });
    }
  });
});



