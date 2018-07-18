const gulp = require("gulp");
const ts = require("gulp-typescript");
const project = ts.createProject("tsconfig.json");

gulp.task("default", function() {
  return project
    .src()
    .pipe(project())
    .pipe(gulp.dest(project.config.compilerOptions.outDir));
});
