document.addEventListener('DOMContentLoaded', () => {
    const draggableCobnut = document.getElementById('draggableCobnut');
    const jarArea = document.getElementById('jarArea');
    const jarImage = document.getElementById('jarImage');
    const cobnutCounterJarDisplay = document.getElementById('cobnutCounterJar');
    const totalCobnutsDisplay = document.getElementById('totalCobnutsDisplay');
    const animationContainer = document.getElementById('animationContainer');
    const funAnimationImg = document.getElementById('funAnimation');

    const emptyJarSrc = jarImage.dataset.emptySrc;
    const fullJarSrc = jarImage.dataset.fullSrc;
    const animationGifSrc = animationContainer.dataset.animationGifSrc;

    // --- NEW: Initialize Audio object for cobnut sound ---
    const cobnutDropSound = new Audio('/static/audio/cobnut_sound.mp3'); // Path to your sound
    cobnutDropSound.preload = 'auto'; // Preload the sound
    // --- END NEW ---

    let isDraggingDesktop = false;
    let isDraggingTouch = false;
    let dragClone = null;

    async function fetchAndUpdateStatus() {
        console.log("Fetching initial cobnut status...");
        try {
            const response = await fetch('/get_cobnuts_status');
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }
            const data = await response.json();
            if (data.error) {
                 console.error("Error from server fetching status:", data.error);
                 updateDisplay(0,0);
                 alert("Could not load cobnut data. Please try refreshing. If the problem persists, the database might need initialization.");
                 return;
            }
            console.log("Initial status received:", data);
            updateDisplay(data.current_cobnuts, data.total_cobnuts);
            if (data.current_cobnuts >= 10) {
                jarImage.src = fullJarSrc;
            } else {
                jarImage.src = emptyJarSrc;
            }
        } catch (error) {
            console.error("Could not fetch cobnut status:", error);
            cobnutCounterJarDisplay.textContent = "Error";
            totalCobnutsDisplay.textContent = "Error";
            jarImage.src = emptyJarSrc;
        }
    }

    function updateDisplay(current, total) {
        cobnutCounterJarDisplay.textContent = `${current}/10`;
        totalCobnutsDisplay.textContent = total;

        if (current >= 10) {
            jarImage.src = fullJarSrc;
        } else if (current === 0) {
            jarImage.src = emptyJarSrc;
        }
    }

    async function handleCobnutDrop() {
        console.log("Cobnut drop detected. Sending request to server...");
        try {
            const response = await fetch('/add_cobnut', { method: 'POST' });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: "Server error, unable to parse JSON."}));
                throw new Error(errorData.error || `Server error: ${response.status}`);
            }
            const data = await response.json();
            console.log("Server response for add_cobnut:", data);

            updateDisplay(data.current_cobnuts, data.total_cobnuts);

            // --- NEW: Play sound effect ---
            if (cobnutDropSound) {
                cobnutDropSound.currentTime = 0; // Rewind to start if playing or played
                cobnutDropSound.play().catch(error => {
                    console.warn("Cobnut sound playback failed:", error);
                    // Autoplay restrictions might prevent sound without user interaction on the page first.
                    // Clicking/dragging the cobnut should count as interaction.
                });
            }
            // --- END NEW ---

            if (data.animation_triggered) {
                await playAnimationAndReset();
            }
        } catch (error) {
            console.error("Could not add cobnut:", error);
            alert(`Error adding cobnut: ${error.message}`);
        }
    }

    // --- Desktop Drag and Drop Logic ---
    draggableCobnut.addEventListener('dragstart', (e) => {
        isDraggingDesktop = true;
        e.dataTransfer.setData('text/plain', 'cobnut');
        draggableCobnut.classList.add('dragging');
        console.log("Desktop drag start");
    });

    draggableCobnut.addEventListener('dragend', () => {
        isDraggingDesktop = false;
        draggableCobnut.classList.remove('dragging');
        console.log("Desktop drag end");
    });

    jarArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        jarArea.classList.add('drag-over');
    });

    jarArea.addEventListener('dragleave', () => {
        jarArea.classList.remove('drag-over');
    });

    jarArea.addEventListener('drop', async (e) => {
        e.preventDefault();
        jarArea.classList.remove('drag-over');
        console.log("Desktop drop on jar");
        if (isDraggingDesktop) {
            await handleCobnutDrop();
        }
        isDraggingDesktop = false;
    });

    // --- Touch events for mobile drag-and-drop ---
    let touchOffsetX = 0, touchOffsetY = 0;

    draggableCobnut.addEventListener('touchstart', (e) => {
        if (e.targetTouches.length === 1) {
            isDraggingTouch = true;
            const touch = e.targetTouches[0];
            const rect = draggableCobnut.getBoundingClientRect();

            dragClone = draggableCobnut.querySelector('img').cloneNode(true);
            dragClone.id = "draggableCobnutClone";
            document.body.appendChild(dragClone);

            touchOffsetX = touch.clientX - rect.left;
            touchOffsetY = touch.clientY - rect.top;

            dragClone.style.left = (touch.clientX - touchOffsetX) + 'px';
            dragClone.style.top = (touch.clientY - touchOffsetY) + 'px';

            draggableCobnut.style.opacity = '0.5';
            console.log("Touch start, clone created");
        }
    }, { passive: true });

    document.body.addEventListener('touchmove', (e) => {
        if (isDraggingTouch && dragClone && e.targetTouches.length === 1) {
            e.preventDefault();
            const touch = e.targetTouches[0];
            dragClone.style.left = (touch.clientX - touchOffsetX) + 'px';
            dragClone.style.top = (touch.clientY - touchOffsetY) + 'px';
        }
    }, { passive: false });

    document.body.addEventListener('touchend', async (e) => {
        if (isDraggingTouch && dragClone) {
            const touch = e.changedTouches[0];

            dragClone.style.display = 'none';
            const droppedElement = document.elementFromPoint(touch.clientX, touch.clientY);
            // dragClone.style.display = ''; // No need to show it again, it will be removed

            if (jarArea.contains(droppedElement) || droppedElement === jarArea) {
                console.log("Touch drop on jar");
                await handleCobnutDrop();
            } else {
                console.log("Touch drop outside jar");
            }

            document.body.removeChild(dragClone);
            dragClone = null;
            draggableCobnut.style.opacity = '1';
            isDraggingTouch = false;
            console.log("Touch end");
        }
    });


    async function playAnimationAndReset() {
        console.log("Attempting to play animation...");
        console.log("Animation GIF SRC from dataset:", animationGifSrc);

        if (!animationGifSrc || animationGifSrc === "null" || animationGifSrc === "undefined") {
            console.error("Animation GIF source is invalid!", animationGifSrc);
            alert("Congratulations! The jar is full! (Animation error)");
            await triggerServerJarReset();
            return;
        }
        
        funAnimationImg.src = animationGifSrc + '?t=' + new Date().getTime();
        console.log("funAnimationImg src set to:", funAnimationImg.src);

        animationContainer.classList.remove('hidden');
        animationContainer.classList.add('visible');

        const computedContainerStyle = window.getComputedStyle(animationContainer);
        const computedImageStyle = window.getComputedStyle(funAnimationImg);

        console.log("animationContainer display (computed):", computedContainerStyle.display);
        console.log("animationContainer offsetWidth:", animationContainer.offsetWidth);
        console.log("funAnimationImg offsetWidth:", funAnimationImg.offsetWidth);
        
        funAnimationImg.onload = () => {
            console.log("GIF image successfully loaded.");
        };
        funAnimationImg.onerror = () => {
            console.error("Error loading GIF image. Check path and file integrity.");
            alert("Congratulations! The jar is full! (Failed to load animation image).");
            animationContainer.classList.remove('visible');
            animationContainer.classList.add('hidden');
            triggerServerJarReset();
        };

        console.log("Hiding game-area and stats-area");
        document.querySelector('.game-area').style.display = 'none';
        document.querySelector('.stats-area').style.display = 'none';

        return new Promise(resolve => {
            setTimeout(async () => {
                console.log("Animation timeout reached. Hiding animation.");
                animationContainer.classList.remove('visible');
                animationContainer.classList.add('hidden');
                funAnimationImg.src = "#"; 

                console.log("Showing game-area and stats-area");
                document.querySelector('.game-area').style.display = 'flex';
                document.querySelector('.stats-area').style.display = 'block';

                await triggerServerJarReset();
                resolve();
            }, 5000);
        });
    }

    async function triggerServerJarReset() {
        try {
            const resetResponse = await fetch('/reset_jar_after_animation', { method: 'POST'});
            if (!resetResponse.ok) {
                throw new Error(`HTTP error! status: ${resetResponse.status}`);
            }
            const resetData = await resetResponse.json();
            updateDisplay(resetData.current_cobnuts, resetData.total_cobnuts);
            console.log("Jar reset confirmed by server:", resetData);
        } catch (error) {
            console.error("Could not reset jar after animation:", error);
            alert("There was an issue resetting the jar. Please try refreshing.");
        }
    }

    // Initial load
    fetchAndUpdateStatus();
});