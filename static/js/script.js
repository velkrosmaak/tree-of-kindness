document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const userSelectionScreen = document.getElementById('userSelectionScreen');
    const userListDiv = document.getElementById('userList');
    const appContainer = document.getElementById('appContainer');
    const changeUserButton = document.getElementById('changeUserButton');

    const currentUserDisplay = document.getElementById('currentUserDisplay');
    const currentUserProfilePic = document.getElementById('currentUserProfilePic');
    const currentUserName = document.getElementById('currentUserName');

    const draggableCobnut = document.getElementById('draggableCobnut');
    const jarArea = document.getElementById('jarArea');
    const jarImage = document.getElementById('jarImage');
    const cobnutCounterJarDisplay = document.getElementById('cobnutCounterJar');
    const totalCobnutsDisplay = document.getElementById('totalCobnutsDisplay');
    const animationContainer = document.getElementById('animationContainer');
    const funAnimationImg = document.getElementById('funAnimation');

    // Data from HTML (passed by Flask's url_for)
    const emptyJarSrc = jarImage.dataset.emptySrc;
    const fullJarSrc = jarImage.dataset.fullSrc;
    const animationGifSrc = animationContainer.dataset.animationGifSrc;

    // Sound
    const cobnutDropSound = new Audio('/static/audio/cobnut_sound.mp3');
    cobnutDropSound.preload = 'auto';

    // App State
    let selectedUserId = null;
    let currentUserTarget = 10; // Default, will be updated
    let isDraggingDesktop = false;
    let isDraggingTouch = false;
    let dragClone = null;
    let touchOffsetX = 0, touchOffsetY = 0;

    // --- User Selection ---
    async function loadUsers() {
        try {
            const response = await fetch('/api/users');
            if (!response.ok) throw new Error('Failed to fetch users');
            const users = await response.json();

            userListDiv.innerHTML = ''; // Clear loading message
            if (users.length === 0) {
                userListDiv.innerHTML = '<p>No users configured. Please visit the <a href="/admin">Admin Panel</a> to add users.</p>';
                return;
            }

            users.forEach(user => {
                const userCard = document.createElement('div');
                userCard.className = 'user-card';
                userCard.dataset.userId = user.id;
                userCard.dataset.userName = user.name; // Store for display
                userCard.dataset.userPic = user.profile_picture_url || '/static/images/cobnut.png'; // Fallback pic
                userCard.dataset.userTarget = user.cobnuts_target;

                const img = document.createElement('img');
                img.src = user.profile_picture_url || '/static/images/cobnut.png'; // Fallback if no pic
                img.alt = user.name;

                const nameP = document.createElement('p');
                nameP.textContent = user.name;

                userCard.appendChild(img);
                userCard.appendChild(nameP);
                userCard.addEventListener('click', () => selectUser(user.id, user.name, user.profile_picture_url, user.cobnuts_target));
                userListDiv.appendChild(userCard);
            });
        } catch (error) {
            console.error("Error loading users:", error);
            userListDiv.innerHTML = '<p>Error loading users. Please try again or check admin setup.</p>';
        }
    }

    function selectUser(userId, name, picUrl, target) {
        selectedUserId = userId;
        currentUserTarget = target;
        localStorage.setItem('selectedUserId', userId); // Persist selection

        // Update current user display in main app
        currentUserName.textContent = name;
        currentUserProfilePic.src = picUrl || '/static/images/cobnut.png';

        userSelectionScreen.style.display = 'none';
        appContainer.style.display = 'flex'; // Or your original display type for app-container
        fetchAndUpdateUserStatus();
    }

    changeUserButton.addEventListener('click', () => {
        selectedUserId = null;
        localStorage.removeItem('selectedUserId');
        appContainer.style.display = 'none';
        userSelectionScreen.style.display = 'flex'; // Or original display type
        loadUsers(); // Refresh user list in case of changes
    });

    // --- Game Logic (User-Specific) ---
    async function fetchAndUpdateUserStatus() {
        if (!selectedUserId) return;
        console.log(`Fetching status for user ${selectedUserId}...`);
        try {
            const response = await fetch(`/api/user_status/${selectedUserId}`);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }
            const data = await response.json();
            if (data.error) {
                console.error("Error from server fetching status:", data.error);
                alert("Could not load your cobnut data. Try changing user or refreshing.");
                return;
            }
            console.log("User status received:", data);
            currentUserTarget = data.cobnuts_target; // Ensure target is up-to-date
            updateDisplay(data.current_cobnuts, data.total_cobnuts);
            if (data.current_cobnuts >= currentUserTarget) {
                jarImage.src = fullJarSrc;
            } else {
                jarImage.src = emptyJarSrc;
            }
        } catch (error) {
            console.error("Could not fetch user cobnut status:", error);
            cobnutCounterJarDisplay.textContent = "Error";
            totalCobnutsDisplay.textContent = "Error";
            jarImage.src = emptyJarSrc;
        }
    }

    function updateDisplay(current, total) {
        cobnutCounterJarDisplay.textContent = `${current}/${currentUserTarget}`;
        totalCobnutsDisplay.textContent = total;

        if (current >= currentUserTarget) {
            jarImage.src = fullJarSrc;
        } else if (current === 0) {
            jarImage.src = emptyJarSrc;
        }
    }

    async function handleCobnutDrop() {
        if (!selectedUserId) {
            alert("Please select a user first!");
            return;
        }
        console.log(`Cobnut drop for user ${selectedUserId}. Sending request...`);
        try {
            const response = await fetch(`/api/add_cobnut/${selectedUserId}`, { method: 'POST' });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: "Server error" }));
                throw new Error(errorData.error || `Server error: ${response.status}`);
            }
            const data = await response.json();
            console.log("Server response for add_cobnut:", data);

            updateDisplay(data.current_cobnuts, data.total_cobnuts); // Target is already set

            if (cobnutDropSound) {
                cobnutDropSound.currentTime = 0;
                cobnutDropSound.play().catch(error => console.warn("Cobnut sound playback failed:", error));
            }

            if (data.animation_triggered) {
                await playAnimationAndReset();
            }
        } catch (error) {
            console.error("Could not add cobnut:", error);
            alert(`Error adding cobnut: ${error.message}`);
        }
    }

    // --- Drag and Drop Logic (No changes needed in mechanics, only in handleCobnutDrop) ---
    draggableCobnut.addEventListener('dragstart', (e) => { /* ... same ... */ });
    draggableCobnut.addEventListener('dragend', () => { /* ... same ... */ });
    jarArea.addEventListener('dragover', (e) => { /* ... same ... */ });
    jarArea.addEventListener('dragleave', () => { /* ... same ... */ });
    jarArea.addEventListener('drop', async (e) => { /* ... same, calls handleCobnutDrop ... */ });
    // Touch events
    draggableCobnut.addEventListener('touchstart', (e) => { /* ... same ... */ });
    document.body.addEventListener('touchmove', (e) => { /* ... same ... */ });
    document.body.addEventListener('touchend', async (e) => { /* ... same, calls handleCobnutDrop ... */ });

    // --- REPASTE of Desktop Drag/Drop and Touch Handlers (Unchanged from previous full version, but ensure they call the NEW handleCobnutDrop) ---
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
            await handleCobnutDrop(); // Calls the user-aware function
        }
        isDraggingDesktop = false;
    });

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
            if (jarArea.contains(droppedElement) || droppedElement === jarArea) {
                await handleCobnutDrop(); // Calls the user-aware function
            }
            document.body.removeChild(dragClone);
            dragClone = null;
            draggableCobnut.style.opacity = '1';
            isDraggingTouch = false;
        }
    });
    // --- End of Drag/Drop handlers ---


    async function playAnimationAndReset() {
        // ... (This function largely remains the same, but uses currentUserTarget indirectly via updateDisplay)
        // The triggerServerJarReset will now need to be user-specific.
        console.log("Attempting to play animation...");
        if (!animationGifSrc) { /* ... error handling ... */ return; }
        funAnimationImg.src = animationGifSrc + '?t=' + new Date().getTime();
        animationContainer.classList.remove('hidden');
        animationContainer.classList.add('visible');
        // ... (logging and hiding game area) ...
        document.querySelector('.game-area').style.display = 'none';
        document.querySelector('.stats-area').style.display = 'none';

        return new Promise(resolve => {
            setTimeout(async () => {
                animationContainer.classList.remove('visible');
                animationContainer.classList.add('hidden');
                funAnimationImg.src = "#";
                document.querySelector('.game-area').style.display = 'flex';
                document.querySelector('.stats-area').style.display = 'block';
                await triggerServerJarReset(); // This needs to be user specific
                resolve();
            }, 5000);
        });
    }

    async function triggerServerJarReset() {
        if (!selectedUserId) return;
        try {
            const response = await fetch(`/api/reset_jar/${selectedUserId}`, { method: 'POST' });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            updateDisplay(data.current_cobnuts, data.total_cobnuts); // Target already known
            console.log("Jar reset for user confirmed by server:", data);
        } catch (error) {
            console.error("Could not reset jar after animation:", error);
            alert("There was an issue resetting the jar. Please try refreshing.");
        }
    }

    // --- Initialization ---
    function initializeApp() {
        const previouslySelectedUserId = localStorage.getItem('selectedUserId');
        if (previouslySelectedUserId) {
            // We need to fetch user details to properly select them
            // For simplicity here, we'll just show selection screen.
            // A more robust way would be to fetch user details for previouslySelectedUserId
            // and if valid, call selectUser directly.
            // For now, always start with user selection or load users.
            console.log("No previously selected user or choosing to re-select.");
            appContainer.style.display = 'none';
            userSelectionScreen.style.display = 'flex'; // Or 'block' or as per your layout
            loadUsers();
        } else {
            appContainer.style.display = 'none';
            userSelectionScreen.style.display = 'flex'; // Or 'block'
            loadUsers();
        }
    }

    initializeApp();
});