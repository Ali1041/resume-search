module "web_app" {
  source = "../modules/web-app"

  app_name             = var.app_name
  resource_group_name  = var.resource_group_name
  location             = var.location
  app_service_plan_id  = var.app_service_plan_id
  runtime              = var.runtime
  runtime_version      = var.runtime_version
  staging_mode         = var.staging_mode
  startup_command      = var.startup_command
  health_check_path    = var.health_check_path
  app_settings         = var.app_settings
  kv_secret_references = var.kv_secret_references

  slot_sticky_setting_names   = var.slot_sticky_setting_names
  operator_object_id          = var.operator_object_id
  deploy_sp_object_id         = var.deploy_sp_object_id
  enable_app_insights         = var.enable_app_insights
  kv_purge_protection_enabled = var.kv_purge_protection_enabled

  tags = merge(
    {
      managed-by = "terraform"
      app        = var.app_name
    },
    var.tags
  )
}
