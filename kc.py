import sqlite3
import os
from flask import Flask, render_template, jsonify, request, g, redirect, url_for, flash
from werkzeug.utils import secure_filename
from datetime import datetime
from flask_httpauth import HTTPBasicAuth # <<< For Basic Authentication

DATABASE = 'cobnuts_multiusers.db'
SCHEMA_FILE = 'schema.sql' # Ensure this file or the string in init_db is updated

# Define upload folders
PROFILE_PIC_UPLOAD_FOLDER = os.path.join('static', 'profile_pics')
ANIMATION_GIF_UPLOAD_FOLDER = os.path.join('static', 'animation_gifs')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}

app = Flask(__name__)
app.config['PROFILE_PIC_UPLOAD_FOLDER'] = PROFILE_PIC_UPLOAD_FOLDER
app.config['ANIMATION_GIF_UPLOAD_FOLDER'] = ANIMATION_GIF_UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024 # 16MB limit for uploads
app.secret_key = 'your_very_secret_admin_key_!please_change!'

# --- Basic Authentication Setup ---
auth = HTTPBasicAuth()
users_auth = {
    "admin": "admin" # In a real app, use hashed passwords & a more secure store
}

@auth.verify_password
def verify_password(username, password):
    if username in users_auth and users_auth.get(username) == password:
        return username
    return None
# --- End Basic Authentication Setup ---

@app.context_processor
def inject_now():
    return {'now': datetime.utcnow()}

# Create upload folders if they don't exist
if not os.path.exists(PROFILE_PIC_UPLOAD_FOLDER):
    os.makedirs(PROFILE_PIC_UPLOAD_FOLDER)
if not os.path.exists(ANIMATION_GIF_UPLOAD_FOLDER):
    os.makedirs(ANIMATION_GIF_UPLOAD_FOLDER)

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db(force_recreate=False):
    schema_path = os.path.join(app.root_path, SCHEMA_FILE)
    # Ensure schema_path uses the updated schema content
    if not os.path.exists(schema_path) or force_recreate: # Simplified logic to ensure schema content is up-to-date
        with open(schema_path, 'w') as f: # Overwrite/create with correct schema
            f.write("""
DROP TABLE IF EXISTS cobnuts_tracker;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    profile_picture TEXT,
    cobnuts_target INTEGER NOT NULL DEFAULT 10,
    animation_gif TEXT
);

CREATE TABLE cobnuts_tracker (
    user_id INTEGER PRIMARY KEY,
    current_cobnuts_in_jar INTEGER NOT NULL DEFAULT 0,
    total_cobnuts_earned INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
            """)
        print(f"{SCHEMA_FILE} created/updated with current schema.")

    with app.app_context():
        db = get_db()
        db_exists = os.path.exists(DATABASE) and os.path.getsize(DATABASE) > 0
        
        if force_recreate or not db_exists:
            print(f"Initializing database from {SCHEMA_FILE}...")
            with app.open_resource(SCHEMA_FILE, mode='r') as f:
                db.cursor().executescript(f.read())
            db.commit()
            print("Database initialized.")
        else:
            # Basic check if 'users' table has 'animation_gif' column
            cursor = db.execute("PRAGMA table_info(users)")
            columns = [row['name'] for row in cursor.fetchall()]
            if 'animation_gif' not in columns:
                print("'animation_gif' column missing from users table. Re-initializing database...")
                # This is a destructive re-initialization if the column is missing.
                # In a production scenario, you'd use migrations.
                with app.open_resource(SCHEMA_FILE, mode='r') as f:
                    db.cursor().executescript(f.read())
                db.commit()
                print("Database re-initialized with new schema including 'animation_gif'.")
            else:
                print("Database already exists and 'animation_gif' column seems present.")


def query_db(query, args=(), one=False):
    cur = get_db().execute(query, args)
    rv = cur.fetchall()
    cur.close()
    return (rv[0] if rv else None) if one else rv

# --- User Management Functions (Admin Backend) ---
def add_user_to_db(name, profile_picture_filename, cobnuts_target, animation_gif_filename): # Added animation_gif
    db = get_db()
    try:
        cursor = db.execute("INSERT INTO users (name, profile_picture, cobnuts_target, animation_gif) VALUES (?, ?, ?, ?)",
                            (name, profile_picture_filename, cobnuts_target, animation_gif_filename))
        db.commit()
        user_id = cursor.lastrowid
        db.execute("INSERT INTO cobnuts_tracker (user_id, current_cobnuts_in_jar, total_cobnuts_earned) VALUES (?, 0, 0)",
                   (user_id,))
        db.commit()
        return user_id
    except sqlite3.IntegrityError:
        return None

def get_all_users_admin():
    return query_db("SELECT id, name, profile_picture, cobnuts_target, animation_gif FROM users ORDER BY name")

def get_user_by_id_admin(user_id):
    return query_db("SELECT id, name, profile_picture, cobnuts_target, animation_gif FROM users WHERE id = ?", (user_id,), one=True)

def update_user_in_db(user_id, name, profile_picture_filename, cobnuts_target, animation_gif_filename): # Added animation_gif
    db = get_db()
    try:
        # Build query dynamically based on whether new files are provided
        fields_to_update = ["name = ?", "cobnuts_target = ?"]
        args = [name, cobnuts_target]

        if profile_picture_filename is not None: # Explicitly check for None, empty string could mean "remove picture" if desired
            fields_to_update.append("profile_picture = ?")
            args.append(profile_picture_filename)
        
        if animation_gif_filename is not None:
            fields_to_update.append("animation_gif = ?")
            args.append(animation_gif_filename)
        
        args.append(user_id)
        query = f"UPDATE users SET {', '.join(fields_to_update)} WHERE id = ?"
        
        db.execute(query, tuple(args))
        db.commit()
        return True
    except sqlite3.IntegrityError:
        return False

def delete_user_from_db(user_id):
    user = get_user_by_id_admin(user_id)
    if user:
        # Delete profile picture
        if user['profile_picture']:
            try:
                file_path = os.path.join(app.config['PROFILE_PIC_UPLOAD_FOLDER'], user['profile_picture'])
                if os.path.exists(file_path): os.remove(file_path)
            except OSError as e: print(f"Error deleting profile pic: {e}")
        # Delete animation GIF
        if user['animation_gif']:
            try:
                file_path = os.path.join(app.config['ANIMATION_GIF_UPLOAD_FOLDER'], user['animation_gif'])
                if os.path.exists(file_path): os.remove(file_path)
            except OSError as e: print(f"Error deleting animation GIF: {e}")

    db = get_db()
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()

# Helper to save uploaded file and return unique filename
def save_upload(file_storage, upload_folder_config_key):
    if file_storage and file_storage.filename != '' and allowed_file(file_storage.filename):
        filename = secure_filename(file_storage.filename)
        base, ext = os.path.splitext(filename)
        counter = 1
        unique_filename = filename
        save_path = os.path.join(app.config[upload_folder_config_key], unique_filename)
        
        while os.path.exists(save_path):
            unique_filename = f"{base}_{counter}{ext}"
            save_path = os.path.join(app.config[upload_folder_config_key], unique_filename)
            counter += 1
        
        file_storage.save(save_path)
        return unique_filename
    return None

# --- Admin Routes (Now with @auth.login_required) ---
@app.route('/admin', methods=['GET', 'POST'])
@auth.login_required
def admin_users():
    if request.method == 'POST':
        name = request.form.get('name')
        cobnuts_target = int(request.form.get('cobnuts_target', 10))
        profile_pic_file = request.files.get('profile_picture')
        animation_gif_file = request.files.get('animation_gif') # New

        if not name: flash('Name is required.', 'error')
        # Profile pic is still required for new user for simplicity, can be made optional
        elif not profile_pic_file or profile_pic_file.filename == '': flash('Profile picture is required.', 'error')
        else:
            profile_pic_filename = save_upload(profile_pic_file, 'PROFILE_PIC_UPLOAD_FOLDER')
            animation_gif_filename = save_upload(animation_gif_file, 'ANIMATION_GIF_UPLOAD_FOLDER') # Can be None

            if not profile_pic_filename: # save_upload returns None on failure/no file
                flash('Invalid profile picture file type or upload error.', 'error')
            # Check animation_gif_file only if it was provided but failed to save
            elif animation_gif_file and animation_gif_file.filename != '' and not animation_gif_filename:
                 flash('Invalid animation GIF file type or upload error.', 'error')
                 if profile_pic_filename: # Clean up successfully uploaded profile pic if animation failed
                    os.remove(os.path.join(app.config['PROFILE_PIC_UPLOAD_FOLDER'], profile_pic_filename))

            else:
                user_id = add_user_to_db(name, profile_pic_filename, cobnuts_target, animation_gif_filename)
                if user_id:
                    flash(f'User {name} added successfully!', 'success')
                else:
                    flash(f'Username {name} already exists or database error.', 'error')
                    # Clean up uploaded files if DB insert failed
                    if profile_pic_filename: os.remove(os.path.join(app.config['PROFILE_PIC_UPLOAD_FOLDER'], profile_pic_filename))
                    if animation_gif_filename: os.remove(os.path.join(app.config['ANIMATION_GIF_UPLOAD_FOLDER'], animation_gif_filename))
            return redirect(url_for('admin_users'))

    users = get_all_users_admin()
    return render_template('admin_users.html', users=users)

@app.route('/admin/edit_user/<int:user_id>', methods=['GET', 'POST'])
@auth.login_required
def admin_edit_user(user_id):
    user = get_user_by_id_admin(user_id)
    if not user:
        flash('User not found.', 'error')
        return redirect(url_for('admin_users'))

    if request.method == 'POST':
        name = request.form.get('name')
        cobnuts_target = int(request.form.get('cobnuts_target', user['cobnuts_target']))
        
        profile_pic_file = request.files.get('profile_picture')
        animation_gif_file = request.files.get('animation_gif')

        new_profile_pic_filename = None # Means "don't change" unless a file is uploaded
        if profile_pic_file and profile_pic_file.filename != '':
            temp_filename = save_upload(profile_pic_file, 'PROFILE_PIC_UPLOAD_FOLDER')
            if temp_filename:
                new_profile_pic_filename = temp_filename
                # Delete old profile picture if a new one is successfully uploaded
                if user['profile_picture'] and user['profile_picture'] != new_profile_pic_filename:
                    old_file_path = os.path.join(app.config['PROFILE_PIC_UPLOAD_FOLDER'], user['profile_picture'])
                    if os.path.exists(old_file_path): os.remove(old_file_path)
            else:
                flash('Invalid new profile picture file. Profile picture not updated.', 'warning')

        new_animation_gif_filename = None # Means "don't change"
        if animation_gif_file and animation_gif_file.filename != '':
            temp_filename = save_upload(animation_gif_file, 'ANIMATION_GIF_UPLOAD_FOLDER')
            if temp_filename:
                new_animation_gif_filename = temp_filename
                # Delete old animation GIF if a new one is successfully uploaded
                if user['animation_gif'] and user['animation_gif'] != new_animation_gif_filename:
                    old_file_path = os.path.join(app.config['ANIMATION_GIF_UPLOAD_FOLDER'], user['animation_gif'])
                    if os.path.exists(old_file_path): os.remove(old_file_path)
            else:
                flash('Invalid new animation GIF file. Animation GIF not updated.', 'warning')
        
        # update_user_in_db expects actual filenames or None if no change for that file
        if update_user_in_db(user_id, name, new_profile_pic_filename, cobnuts_target, new_animation_gif_filename):
            flash(f'User {name} updated successfully!', 'success')
        else:
            flash(f'Failed to update user {name}. Name might already exist.', 'error')
        return redirect(url_for('admin_users'))

    return render_template('admin_edit_user.html', user=user)


@app.route('/admin/delete_user/<int:user_id>', methods=['POST'])
@auth.login_required
def admin_delete_user(user_id):
    user = get_user_by_id_admin(user_id)
    if user:
        delete_user_from_db(user_id)
        flash(f'User {user["name"]} and their data deleted successfully!', 'success')
    else:
        flash('User not found or already deleted.', 'warning')
    return redirect(url_for('admin_users'))


# --- API Endpoints ---
@app.route('/api/users', methods=['GET'])
def api_get_users():
    users_from_db = query_db("SELECT id, name, profile_picture, cobnuts_target, animation_gif FROM users ORDER BY name")
    users_list = []
    if users_from_db:
        for u in users_from_db:
            profile_pic_url = None
            if u['profile_picture']:
                actual_filename = os.path.basename(u['profile_picture'])
                path_in_static = f"profile_pics/{actual_filename}"
                profile_pic_url = url_for('static', filename=path_in_static)
            
            animation_gif_url = None # Default/fallback animation can be handled by JS
            if u['animation_gif']:
                actual_filename = os.path.basename(u['animation_gif'])
                path_in_static = f"animation_gifs/{actual_filename}"
                animation_gif_url = url_for('static', filename=path_in_static)

            users_list.append({
                'id': u['id'],
                'name': u['name'],
                'profile_picture_url': profile_pic_url,
                'cobnuts_target': u['cobnuts_target'],
                'animation_gif_url': animation_gif_url # Added
            })
    return jsonify(users_list)

# ... (api_get_user_status, api_add_cobnut, api_reset_jar remain largely the same, but ensure they don't break) ...
# They don't directly use animation_gif, but cobnuts_target is important.

@app.route('/api/user_status/<int:user_id>', methods=['GET'])
def api_get_user_status(user_id):
    user_info = query_db("SELECT cobnuts_target, animation_gif FROM users WHERE id = ?", (user_id,), one=True) # fetch animation_gif too
    if not user_info:
        return jsonify({'error': 'User not found'}), 404
    
    tracker_info = query_db("SELECT current_cobnuts_in_jar, total_cobnuts_earned FROM cobnuts_tracker WHERE user_id = ?", (user_id,), one=True)
    if not tracker_info:
        db = get_db()
        db.execute("INSERT OR IGNORE INTO cobnuts_tracker (user_id, current_cobnuts_in_jar, total_cobnuts_earned) VALUES (?, 0, 0)", (user_id,))
        db.commit()
        tracker_info = {'current_cobnuts_in_jar': 0, 'total_cobnuts_earned': 0}

    animation_gif_url = None
    if user_info['animation_gif']:
        actual_filename = os.path.basename(user_info['animation_gif'])
        path_in_static = f"animation_gifs/{actual_filename}"
        animation_gif_url = url_for('static', filename=path_in_static)

    return jsonify({
        'user_id': user_id,
        'current_cobnuts': tracker_info['current_cobnuts_in_jar'],
        'total_cobnuts': tracker_info['total_cobnuts_earned'],
        'cobnuts_target': user_info['cobnuts_target'],
        'animation_gif_url': animation_gif_url # Also return here for consistency if needed by game directly
    })

@app.route('/api/add_cobnut/<int:user_id>', methods=['POST'])
def api_add_cobnut(user_id):
    db = get_db()
    user_info = query_db("SELECT cobnuts_target FROM users WHERE id = ?", (user_id,), one=True)
    if not user_info: return jsonify({'error': 'User not found'}), 404
    tracker_info = query_db("SELECT current_cobnuts_in_jar, total_cobnuts_earned FROM cobnuts_tracker WHERE user_id = ?", (user_id,), one=True)
    if not tracker_info: return jsonify({'error': 'User tracking data not found.'}), 500

    current_cobnuts, total_cobnuts, cobnuts_target = tracker_info['current_cobnuts_in_jar'], tracker_info['total_cobnuts_earned'], user_info['cobnuts_target']
    new_current_cobnuts, new_total_cobnuts = current_cobnuts + 1, total_cobnuts + 1
    animation_triggered = new_current_cobnuts >= cobnuts_target

    db.execute("UPDATE cobnuts_tracker SET current_cobnuts_in_jar = ?, total_cobnuts_earned = ? WHERE user_id = ?",
               (new_current_cobnuts, new_total_cobnuts, user_id))
    db.commit()
    
    return jsonify({
        'current_cobnuts': new_current_cobnuts, 'total_cobnuts': new_total_cobnuts,
        'cobnuts_target': cobnuts_target, 'animation_triggered': animation_triggered
    })

@app.route('/api/reset_jar/<int:user_id>', methods=['POST'])
def api_reset_jar(user_id):
    db = get_db()
    user_info = query_db("SELECT cobnuts_target FROM users WHERE id = ?", (user_id,), one=True)
    if not user_info: return jsonify({'error': 'User not found for target retrieval'}), 404
    tracker_info = query_db("SELECT total_cobnuts_earned FROM cobnuts_tracker WHERE user_id = ?", (user_id,), one=True)
    if not tracker_info: return jsonify({'error': 'User tracking not found for reset'}), 404
    
    db.execute("UPDATE cobnuts_tracker SET current_cobnuts_in_jar = 0 WHERE user_id = ?", (user_id,))
    db.commit()
    return jsonify({
        'current_cobnuts': 0, 'total_cobnuts': tracker_info['total_cobnuts_earned'],
        'cobnuts_target': user_info['cobnuts_target']
    })

# --- Main App Route ---
@app.route('/')
def index():
    return render_template('index.html')

# --- CLI command to initialize DB ---
@app.cli.command('initdb')
def initdb_command():
    """Initializes the database."""
    init_db(force_recreate=True) # Force schema update
    print('Database initialized/updated.')

if __name__ == '__main__':
    init_db() # Initialize DB on first run if needed
    app.run(debug=True, port=5001)