import sqlite3
import os
from flask import Flask, render_template, jsonify, request, g, redirect, url_for, flash
from werkzeug.utils import secure_filename
from datetime import datetime

DATABASE = 'cobnuts_multiusers.db'
SCHEMA_FILE = 'schema.sql'
UPLOAD_FOLDER = os.path.join('static', 'profile_pics') # Correctly uses os.path.join for FS path
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024 # 16MB limit for uploads
app.secret_key = 'your_very_secret_admin_key' # Change this!


@app.context_processor
def inject_now():
    return {'now': datetime.utcnow()} # Provides a datetime object


if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# --- Utility Functions ---
def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- Database Helper Functions ---
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON") # Enable foreign key enforcement
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db(force_recreate=False):
    schema_path = os.path.join(app.root_path, SCHEMA_FILE)
    if not os.path.exists(schema_path):
        with open(schema_path, 'w') as f:
            f.write("""
DROP TABLE IF EXISTS cobnuts_tracker;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    profile_picture TEXT,
    cobnuts_target INTEGER NOT NULL DEFAULT 10
);

CREATE TABLE cobnuts_tracker (
    user_id INTEGER PRIMARY KEY,
    current_cobnuts_in_jar INTEGER NOT NULL DEFAULT 0,
    total_cobnuts_earned INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
            """)
        print(f"{SCHEMA_FILE} created.")

    with app.app_context():
        db = get_db()
        db_exists = os.path.exists(DATABASE) and os.path.getsize(DATABASE) > 0
        
        if force_recreate or not db_exists:
            print(f"Initializing database from {SCHEMA_FILE}...")
            with app.open_resource(SCHEMA_FILE, mode='r') as f:
                db.cursor().executescript(f.read())
            db.commit()
            print("Database initialized with new schema.")
        else:
            cursor = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND (name='users' OR name='cobnuts_tracker')")
            tables = [row[0] for row in cursor.fetchall()]
            if 'users' not in tables or 'cobnuts_tracker' not in tables:
                print("One or more tables missing, re-initializing...")
                with app.open_resource(SCHEMA_FILE, mode='r') as f:
                    db.cursor().executescript(f.read())
                db.commit()
                print("Database re-initialized.")
            else:
                print("Database already exists and tables seem present.")


def query_db(query, args=(), one=False):
    cur = get_db().execute(query, args)
    rv = cur.fetchall()
    cur.close()
    return (rv[0] if rv else None) if one else rv

# --- User Management Functions (Admin Backend) ---
def add_user_to_db(name, profile_picture_filename, cobnuts_target):
    db = get_db()
    try:
        cursor = db.execute("INSERT INTO users (name, profile_picture, cobnuts_target) VALUES (?, ?, ?)",
                            (name, profile_picture_filename, cobnuts_target))
        db.commit()
        user_id = cursor.lastrowid
        db.execute("INSERT INTO cobnuts_tracker (user_id, current_cobnuts_in_jar, total_cobnuts_earned) VALUES (?, 0, 0)",
                   (user_id,))
        db.commit()
        return user_id
    except sqlite3.IntegrityError:
        return None

def get_all_users_admin():
    return query_db("SELECT id, name, profile_picture, cobnuts_target FROM users ORDER BY name")

def get_user_by_id_admin(user_id):
    return query_db("SELECT id, name, profile_picture, cobnuts_target FROM users WHERE id = ?", (user_id,), one=True)

def update_user_in_db(user_id, name, profile_picture_filename, cobnuts_target):
    db = get_db()
    try:
        if profile_picture_filename: # If a new filename is provided (even if it's the same, it means "update picture")
            db.execute("UPDATE users SET name = ?, profile_picture = ?, cobnuts_target = ? WHERE id = ?",
                       (name, profile_picture_filename, cobnuts_target, user_id))
        else: # No new picture uploaded, only update name and target
            db.execute("UPDATE users SET name = ?, cobnuts_target = ? WHERE id = ?",
                       (name, cobnuts_target, user_id))
        db.commit()
        return True
    except sqlite3.IntegrityError:
        return False

def delete_user_from_db(user_id):
    user = get_user_by_id_admin(user_id)
    if user and user['profile_picture']:
        try:
            # Construct full path to the file to be deleted
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], user['profile_picture'])
            if os.path.exists(file_path):
                 os.remove(file_path)
                 print(f"Deleted profile picture: {user['profile_picture']}")
            else:
                print(f"Profile picture file not found, cannot delete: {file_path}")
        except OSError as e:
            print(f"Error deleting profile picture file {user['profile_picture']}: {e}")

    db = get_db()
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()


# --- Admin Routes ---
@app.route('/admin', methods=['GET', 'POST'])
def admin_users():
    if request.method == 'POST':
        name = request.form.get('name')
        cobnuts_target_str = request.form.get('cobnuts_target', '10')
        try:
            cobnuts_target = int(cobnuts_target_str)
            if cobnuts_target < 1:
                cobnuts_target = 1 # Enforce minimum
        except ValueError:
            cobnuts_target = 10 # Default on error
            
        profile_pic_file = request.files.get('profile_picture')
        
        if not name:
            flash('Name is required.', 'error')
        elif not profile_pic_file or profile_pic_file.filename == '':
            flash('Profile picture is required.', 'error')
        elif not allowed_file(profile_pic_file.filename):
            flash('Invalid image file type.', 'error')
        else:
            filename = secure_filename(profile_pic_file.filename) # This is just the filename
            base, ext = os.path.splitext(filename)
            counter = 1
            unique_filename = filename # This will be stored in DB
            # Construct full path for saving the file
            save_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
            
            while os.path.exists(save_path):
                unique_filename = f"{base}_{counter}{ext}"
                save_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
                counter += 1
            
            profile_pic_file.save(save_path)
            
            user_id = add_user_to_db(name, unique_filename, cobnuts_target) # Store only the filename
            if user_id:
                flash(f'User {name} added successfully!', 'success')
            else:
                flash(f'Username {name} already exists or database error.', 'error')
                if os.path.exists(save_path): # Clean up uploaded file if DB insert failed
                    os.remove(save_path)

        return redirect(url_for('admin_users'))

    users = get_all_users_admin()
    return render_template('admin_users.html', users=users)

@app.route('/admin/edit_user/<int:user_id>', methods=['GET', 'POST'])
def admin_edit_user(user_id):
    user = get_user_by_id_admin(user_id)
    if not user:
        flash('User not found.', 'error')
        return redirect(url_for('admin_users'))

    if request.method == 'POST':
        name = request.form.get('name')
        cobnuts_target_str = request.form.get('cobnuts_target', '10')
        try:
            cobnuts_target = int(cobnuts_target_str)
            if cobnuts_target < 1:
                cobnuts_target = 1
        except ValueError:
            cobnuts_target = user['cobnuts_target'] # Keep old on error
            
        profile_pic_file = request.files.get('profile_picture')
        
        db_filename_to_store = user['profile_picture'] # Start with existing filename

        if profile_pic_file and profile_pic_file.filename != '':
            if allowed_file(profile_pic_file.filename):
                new_secure_filename = secure_filename(profile_pic_file.filename)
                
                # Check if the new filename is different from the old one before generating unique name & deleting
                # This avoids deleting and re-saving if the file content changes but name is the same
                # (though new unique name logic will handle collisions anyway)
                
                old_file_path = None
                if user['profile_picture']:
                    old_file_path = os.path.join(app.config['UPLOAD_FOLDER'], user['profile_picture'])

                # Generate unique name for the new file
                base, ext = os.path.splitext(new_secure_filename)
                counter = 1
                potential_new_filename = new_secure_filename
                save_path = os.path.join(app.config['UPLOAD_FOLDER'], potential_new_filename)
                
                while os.path.exists(save_path) and (not old_file_path or save_path != old_file_path):
                    # Ensure unique name unless it's the same as the existing file path for this user
                    potential_new_filename = f"{base}_{counter}{ext}"
                    save_path = os.path.join(app.config['UPLOAD_FOLDER'], potential_new_filename)
                    counter += 1
                
                profile_pic_file.save(save_path)
                db_filename_to_store = potential_new_filename # This is the new filename to store in DB

                # Delete old picture if it's different from the new one and exists
                if old_file_path and os.path.exists(old_file_path) and old_file_path != save_path:
                    try:
                        os.remove(old_file_path)
                        print(f"Deleted old profile picture: {user['profile_picture']}")
                    except OSError as e:
                        print(f"Error deleting old profile pic {user['profile_picture']}: {e}")
            else:
                flash('Invalid image file type for new picture. Picture not updated.', 'warning')
                # db_filename_to_store remains user['profile_picture']
        
        # Pass db_filename_to_store if a new file was processed, else None if no new file was intended for update_user_in_db
        # The update_user_in_db function expects None for profile_picture_filename if it shouldn't be changed.
        filename_for_db_update = None
        if profile_pic_file and profile_pic_file.filename != '' and allowed_file(profile_pic_file.filename):
            filename_for_db_update = db_filename_to_store


        if update_user_in_db(user_id, name, filename_for_db_update, cobnuts_target):
            flash(f'User {name} updated successfully!', 'success')
        else:
            flash(f'Failed to update user {name}. Name might already exist.', 'error')
        return redirect(url_for('admin_users'))

    return render_template('admin_edit_user.html', user=user)


@app.route('/admin/delete_user/<int:user_id>', methods=['POST'])
def admin_delete_user(user_id):
    user = get_user_by_id_admin(user_id)
    if user:
        delete_user_from_db(user_id) # This function now handles deleting the file
        flash(f'User {user["name"]} and their data deleted successfully!', 'success')
    else:
        flash('User not found or already deleted.', 'warning')
    return redirect(url_for('admin_users'))


# --- API Endpoints for Frontend User Selection and Game ---
@app.route('/api/users', methods=['GET'])
def api_get_users():
    users_from_db = query_db("SELECT id, name, profile_picture, cobnuts_target FROM users ORDER BY name")
    users_list = []
    if users_from_db:
        for u in users_from_db:
            profile_picture_url = None
            db_filename = u['profile_picture'] # This is just the filename, e.g., "my_image.png"
            
            if db_filename:
                # Ensure we only have the filename part, strip any errant path components from DB value
                actual_filename = os.path.basename(db_filename) 
                # Construct the path for url_for using forward slashes, relative to 'static'
                path_in_static = f"profile_pics/{actual_filename}" # e.g., "profile_pics/my_image.png"
                profile_picture_url = url_for('static', filename=path_in_static)
            
            users_list.append({
                'id': u['id'],
                'name': u['name'],
                'profile_picture_url': profile_picture_url, # <<< CORRECTED LOGIC
                'cobnuts_target': u['cobnuts_target']
            })
    return jsonify(users_list)

@app.route('/api/user_status/<int:user_id>', methods=['GET'])
def api_get_user_status(user_id):
    user_info = query_db("SELECT cobnuts_target FROM users WHERE id = ?", (user_id,), one=True)
    if not user_info:
        return jsonify({'error': 'User not found'}), 404
    
    tracker_info = query_db("SELECT current_cobnuts_in_jar, total_cobnuts_earned FROM cobnuts_tracker WHERE user_id = ?", (user_id,), one=True)
    if not tracker_info:
        db = get_db()
        db.execute("INSERT OR IGNORE INTO cobnuts_tracker (user_id, current_cobnuts_in_jar, total_cobnuts_earned) VALUES (?, 0, 0)", (user_id,))
        db.commit()
        tracker_info = {'current_cobnuts_in_jar': 0, 'total_cobnuts_earned': 0}

    return jsonify({
        'user_id': user_id,
        'current_cobnuts': tracker_info['current_cobnuts_in_jar'],
        'total_cobnuts': tracker_info['total_cobnuts_earned'],
        'cobnuts_target': user_info['cobnuts_target']
    })

@app.route('/api/add_cobnut/<int:user_id>', methods=['POST'])
def api_add_cobnut(user_id):
    db = get_db()
    user_info = query_db("SELECT cobnuts_target FROM users WHERE id = ?", (user_id,), one=True)
    if not user_info:
        return jsonify({'error': 'User not found'}), 404

    tracker_info = query_db("SELECT current_cobnuts_in_jar, total_cobnuts_earned FROM cobnuts_tracker WHERE user_id = ?", (user_id,), one=True)
    if not tracker_info:
        return jsonify({'error': 'User tracking data not found. Please re-select user or contact admin.'}), 500

    current_cobnuts = tracker_info['current_cobnuts_in_jar']
    total_cobnuts = tracker_info['total_cobnuts_earned']
    cobnuts_target = user_info['cobnuts_target']

    new_current_cobnuts = current_cobnuts + 1
    new_total_cobnuts = total_cobnuts + 1
    animation_triggered = False

    if new_current_cobnuts >= cobnuts_target:
        animation_triggered = True
        db.execute("UPDATE cobnuts_tracker SET current_cobnuts_in_jar = ?, total_cobnuts_earned = ? WHERE user_id = ?",
                   (new_current_cobnuts, new_total_cobnuts, user_id))
    else:
        db.execute("UPDATE cobnuts_tracker SET current_cobnuts_in_jar = ?, total_cobnuts_earned = ? WHERE user_id = ?",
                   (new_current_cobnuts, new_total_cobnuts, user_id))
    db.commit()
    
    return jsonify({
        'message': 'Cobnut added!',
        'current_cobnuts': new_current_cobnuts,
        'total_cobnuts': new_total_cobnuts,
        'cobnuts_target': cobnuts_target,
        'animation_triggered': animation_triggered
    })

@app.route('/api/reset_jar/<int:user_id>', methods=['POST'])
def api_reset_jar(user_id):
    db = get_db()
    tracker_info = query_db("SELECT total_cobnuts_earned FROM cobnuts_tracker WHERE user_id = ?", (user_id,), one=True)
    if not tracker_info:
        return jsonify({'error': 'User tracking not found'}), 404
    
    total_cobnuts = tracker_info['total_cobnuts_earned']
    db.execute("UPDATE cobnuts_tracker SET current_cobnuts_in_jar = 0 WHERE user_id = ?", (user_id,))
    db.commit()

    user_info = query_db("SELECT cobnuts_target FROM users WHERE id = ?", (user_id,), one=True)

    return jsonify({
        'message': 'Jar reset for user.',
        'current_cobnuts': 0,
        'total_cobnuts': total_cobnuts,
        'cobnuts_target': user_info['cobnuts_target'] if user_info else 10
    })

# --- Main App Route ---
@app.route('/')
def index():
    return render_template('index.html')

# --- CLI command to initialize DB ---
@app.cli.command('initdb')
def initdb_command():
    """Initializes the database."""
    init_db(force_recreate=True)
    print('Initialized the database with new multi-user schema.')

if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5001)