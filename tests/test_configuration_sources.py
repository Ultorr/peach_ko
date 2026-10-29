"""CloudDrive 表单、来源映射与离线状态的隔离回归。"""
from dataclasses import replace
import ntpath
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from peach import media_configuration as media_config, onboarding, settings_file


class MediaConfigurationTests(unittest.TestCase):
    def test_setup_local_source_accepts_a_mapped_nas_drive(self):
        from peach.routes_pages import _read_answers

        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory).resolve()
            config = settings_file.load_config(environ={"PEACH_DATA_ROOT": str(base)})
            mapped = r"Z:\CloudDrive2\115open\云下载"
            submitted = {"data_root": str(base), "media_dir": [mapped],
                         "media_location": ["local"], "host": "1"}
            windows_abspath = ntpath.abspath
            with patch.object(Path, "is_dir", return_value=True), \
                    patch.object(Path, "resolve", return_value=Path(r"\\NAS\媒体库")), \
                    patch("peach.onboarding.os.path.abspath", side_effect=windows_abspath):
                answers, errors = _read_answers(config, submitted, windows=True)
            self.assertEqual(errors, {})
            prepared = onboarding.configure(config, answers, windows=True)
            self.assertEqual(prepared.locations, {"local": (mapped,)})
            self.assertEqual(prepared.mounts, {})

    def test_runtime_facts_name_the_operating_system_and_settings_file(self):
        from peach import web_entry
        with tempfile.TemporaryDirectory() as directory:
            config = settings_file.load_config(environ={"PEACH_DATA_ROOT": str(Path(directory).resolve())})
            facts = dict(web_entry.runtime_facts(config))
            self.assertIn("운영체제", facts)
            self.assertIn("설정 파일", facts)

    def test_runtime_fact_entries_list_dependencies_only_when_missing(self):
        from peach import web_entry
        with tempfile.TemporaryDirectory() as directory:
            config = settings_file.load_config(environ={"PEACH_DATA_ROOT": str(Path(directory).resolve())})
            with patch("peach.ffmpeg.FFmpegResolver.ffmpeg", return_value=Path("ffmpeg")), \
                    patch("peach.ffmpeg.FFmpegResolver.ffprobe", return_value=Path("ffprobe")), \
                    patch("peach.mp4recover.untrunc_path", return_value=Path("untrunc")):
                present = [row["term"] for row in web_entry.runtime_fact_entries(config)]
            with patch("peach.ffmpeg.FFmpegResolver.ffmpeg", return_value=None), \
                    patch("peach.ffmpeg.FFmpegResolver.ffprobe", return_value=None), \
                    patch("peach.mp4recover.untrunc_path", return_value=None):
                missing = {row["term"]: row for row in web_entry.runtime_fact_entries(config)}
        self.assertNotIn("FFmpeg", present)
        self.assertNotIn("untrunc", present)
        self.assertIn("버전", present)
        self.assertEqual(missing["FFmpeg"]["download_label"], "FFmpeg 다운로드")
        self.assertEqual(missing["untrunc"]["download_label"], "untrunc 다운로드")

    def test_windows_cloud_sources_keep_policy_ids_and_offline_roots(self):
        roots, mounts, errors = media_config.validate([
            {"location": "115", "path": "B:/"}, {"location": "pikpak", "path": "A:/"},
        ], windows=True)
        self.assertFalse(errors)
        self.assertEqual(roots, {"115": ("B:\\",), "pikpak": ("A:\\",)})
        self.assertEqual(mounts, {})

    def test_macos_multiple_mounts_preserve_declared_root_order(self):
        roots, mounts, errors = media_config.validate([
            {"location": "115", "root": "B:/Movies", "path": "/Volumes/115/Movies"},
            {"location": "115", "root": "B:/Photos", "path": "/Volumes/115/Photos"},
        ], windows=False)
        self.assertFalse(errors)
        self.assertEqual(roots["115"], ("B:\\Movies", "B:\\Photos"))
        self.assertEqual(mounts["115"], ("/Volumes/115/Movies", "/Volumes/115/Photos"))

    def test_windows_network_shares_require_a_mapped_drive(self):
        roots, mounts, errors = media_config.validate([
            {"location": "115", "path": r"\\nas\media\115"},
        ], windows=True)
        self.assertEqual(roots, {})
        self.assertEqual(mounts, {})
        self.assertIn("Windows 드라이브 문자에 먼저 연결하세요", errors[0])
        with patch.object(media_config, "mount_dependencies", return_value=[]):
            roots, mounts, errors = media_config.validate([
                {"location": "115", "path": r"Z:\视频"},
            ], windows=True)
        self.assertFalse(errors)
        self.assertEqual(roots, {"115": ("Z:\\视频",)})
        self.assertEqual(mounts, {})

    def test_invalid_and_overlapping_roots_return_row_errors(self):
        for rows in ([{"location": "bad", "path": "B:/"}],
                     [{"location": [], "path": "B:/"}],
                     [{"location": "115", "path": "B:/bad\u0000file"}],
                     [{"location": "115", "path": "../115"}],
                     [{"location": "115", "path": "B:/"}, {"location": "local", "path": "b:/Movies"}]):
            self.assertTrue(media_config.validate(rows, windows=True)[2])

    def test_cloud_only_setup_roundtrips_config_without_local_source(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory).resolve()
            config = settings_file.load_config(environ={"PEACH_DATA_ROOT": str(base)})
            answers = onboarding.Answers(base, (), "127.0.0.1", 8900, "peach", [
                {"location": "115", "path": "/Volumes/115", "root": "B:/"}])
            prepared = onboarding.configure(config, answers, windows=False)
            settings_file.write(prepared)
            loaded = settings_file.load_config(environ={"PEACH_DATA_ROOT": str(base)})
            self.assertEqual(loaded.locations, {"115": ("B:\\",)})
            self.assertEqual(loaded.mounts, {"115": ("/Volumes/115",)})
            self.assertFalse((base / "database" / "ledger.db").exists())

    def test_unreadable_existing_mount_is_offline(self):
        config = replace(settings_file.PeachConfig(Path('/unused'), Path('/unused/config.toml')), locations={"115": ("B:/",)}, mounts={"115": ("/Volumes/115",)})
        with patch("peach.platform.os.scandir", side_effect=OSError("Device not configured")):
            self.assertFalse(media_config.rows(config, windows=False, probe=True)[0]["online"])

    def test_setup_answers_keep_the_cloud_source_and_its_windows_root(self):
        from peach.routes_pages import _read_answers
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory).resolve()
            config = settings_file.load_config(environ={"PEACH_DATA_ROOT": str(base)})
            submitted = {"data_root": str(base), "media_dir": ["/Volumes/115"],
                         "media_location": ["115"], "media_root": ["B:/"], "host": "1"}
            answers, errors = _read_answers(config, submitted, windows=False)
            self.assertFalse(errors)
            self.assertEqual(answers.media_sources[0]["location"], "115")
            self.assertEqual(answers.media_sources[0]["root"], "B:/")

    def test_setup_local_source_reports_native_directory_error_first(self):
        from peach.routes_pages import _setup_media_source_errors

        def missing_directory(_path):
            raise ValueError("目录不存在：/missing")

        errors = _setup_media_source_errors(
            ["/missing"], ["local"],
            ["Windows 中的对应路径必须包含盘符，例如 B:\\"], missing_directory,
        )
        self.assertEqual(errors, ["目录不存在：/missing"])

    def test_completion_facts_and_entry_leave_out_mounts_and_internals(self):
        from peach.routes_pages import _setup_destination
        from peach.web_entry import runtime_fact_entries
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory).resolve()
            config = replace(settings_file.load_config(environ={"PEACH_DATA_ROOT": str(base)}),
                             locations={"115": ("B:/",)}, mounts={"115": ("/Volumes/115",)})
            shown = " ".join(row["value"] for row in runtime_fact_entries(config))
            for internal in ('/Volumes/115', 'peach scan configured', '本机 CA', '已应用 0 个迁移'):
                self.assertNotIn(internal, shown)
            with patch('peach.distribution.standalone', return_value=False):
                self.assertEqual(_setup_destination(config, history_guide=False),
                                 f'http://127.0.0.1:{config.server.port}/?onboarding=1')
            with patch('peach.distribution.standalone', return_value=True):
                self.assertEqual(_setup_destination(config, history_guide=True),
                                 f'http://127.0.0.1:{config.server.port}/taste?onboarding=1')
